// lib/paj/webhookConfig.ts
//
// Makes the Paj ramp webhook a real, self-configuring endpoint instead of a
// URL that has to be pasted into the dashboard by hand.
//
// Paj ties the webhook endpoint AND its signing secret to the API key, and
// only returns the secret from PATCH /pub/v2/webhook. So "register" is one
// call that both points deliveries at Comparta and hands us the secret to
// verify them with. The secret is stored encrypted (see secretBox.ts) so a
// restart keeps verifying without an env var.
//
// Resolution order for verification:
//   1. PAJ_CASH_WEBHOOK_SECRET  (explicit operator override, always wins)
//   2. PajWebhookConfig row     (obtained by registering the endpoint)
//   3. none                     (delivery is stored but treated as unverified)

import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { resolveAppNetwork } from "@/lib/config/network";
import { testPajWebhook, updatePajWebhooks } from "./api";
import {
  getPajWebhookTarget,
  type PajWebhookTarget,
} from "./config";
import { openPajWebhookSecret, sealPajWebhookSecret } from "./secretBox";
import type { PajWebhookTestResult } from "./types";

const CONFIG_ID = "default";
const SECRET_CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 30_000;

export class PajWebhookConfigError extends Error {
  constructor(
    message: string,
    public readonly code = "PAJ_WEBHOOK_ERROR",
    public readonly status = 422
  ) {
    super(message);
    this.name = "PajWebhookConfigError";
  }
}

export interface PajWebhookSecret {
  secret: string | null;
  source: "env" | "stored" | "none";
  error: string | null;
}

let secretCache:
  | { key: string; value: PajWebhookSecret; at: number }
  | null = null;

function cacheKey(): string {
  const env = getEnv();
  return `${env.PAJ_CASH_API_KEY ?? ""}:${env.PAJ_CASH_WEBHOOK_SECRET ? "env" : "db"}`;
}

/** The secret used to verify X-PAJ-Signature. Cached briefly. */
export async function getPajWebhookSecret(): Promise<PajWebhookSecret> {
  const env = getEnv();
  if (env.PAJ_CASH_WEBHOOK_SECRET) {
    return { secret: env.PAJ_CASH_WEBHOOK_SECRET, source: "env", error: null };
  }

  const key = cacheKey();
  const cached = secretCache;
  if (cached && cached.key === key) {
    const ttl = cached.value.secret ? SECRET_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.value;
  }

  let value: PajWebhookSecret = {
    secret: null,
    source: "none",
    error: "No Paj webhook secret is configured or stored yet.",
  };

  try {
    const row = await prisma.pajWebhookConfig.findUnique({
      where: { id: CONFIG_ID },
      select: { secretCipher: true },
    });
    const secret = row?.secretCipher
      ? openPajWebhookSecret(row.secretCipher)
      : null;
    if (secret) {
      value = { secret, source: "stored", error: null };
    } else if (row?.secretCipher) {
      value = {
        secret: null,
        source: "none",
        error:
          "The stored webhook secret can no longer be decrypted (API key rotated?). Re-register the webhook.",
      };
    }
  } catch (err) {
    // A database hiccup must not drop a delivery on the floor: the route
    // stores it unverified and polling still reconciles the order.
    value = {
      secret: null,
      source: "none",
      error: err instanceof Error ? err.message : "Could not read the webhook secret.",
    };
  }

  secretCache = { key, value, at: Date.now() };
  return value;
}

export function invalidatePajWebhookSecretCache(): void {
  secretCache = null;
}

function autoRegisterAllowed(): boolean {
  const env = getEnv();
  if (env.PAJ_CASH_WEBHOOK_AUTO_REGISTER === "false") return false;
  // Never mutate the key's configuration from a preview/local deployment:
  // several deployments sharing one key would otherwise fight over the URL.
  return getPajWebhookTarget().source === "env" || resolveAppNetwork() === "mainnet";
}

export interface PajWebhookRegistration {
  url: string;
  registeredAt: string;
  secretSource: "env" | "stored" | "missing";
  secretHint: string | null;
}

/**
 * Point the API key's rampWebhookURL at Comparta and store the returned
 * signing secret. Safe to call repeatedly; an unchanged URL is a no-op that
 * still returns the secret.
 */
export async function registerPajWebhook(): Promise<PajWebhookRegistration> {
  const target = getPajWebhookTarget();
  if (!target.url || !target.public) {
    throw new PajWebhookConfigError(
      target.reason ?? "Set a public https webhook URL before connecting Paj.",
      "PAJ_WEBHOOK_URL_UNREACHABLE"
    );
  }

  let config;
  try {
    config = await updatePajWebhooks({ rampWebhookURL: target.url });
  } catch (err) {
    throw new PajWebhookConfigError(
      err instanceof Error ? err.message : "Paj rejected the webhook update.",
      "PAJ_WEBHOOK_REGISTER_FAILED",
      502
    );
  }

  const secret = config.webhookSecret?.trim() || null;
  const sealed = secret ? sealPajWebhookSecret(secret) : null;
  const registeredAt = new Date();

  if (secret && !sealed) {
    throw new PajWebhookConfigError(
      "PAJ_CASH_API_KEY is required to store the webhook secret securely.",
      "PAJ_WEBHOOK_SECRET_STORE_FAILED",
      503
    );
  }

  await prisma.pajWebhookConfig.upsert({
    where: { id: CONFIG_ID },
    create: {
      id: CONFIG_ID,
      rampWebhookUrl: target.url,
      secretCipher: sealed,
      secretHint: secret ? secret.slice(-4) : null,
      registeredAt,
    },
    update: {
      rampWebhookUrl: target.url,
      registeredAt,
      ...(sealed
        ? { secretCipher: sealed, secretHint: secret ? secret.slice(-4) : null }
        : {}),
    },
  });

  invalidatePajWebhookSecretCache();

  const envSecret = getEnv().PAJ_CASH_WEBHOOK_SECRET;
  const verificationSecret = envSecret ?? secret;

  return {
    url: config.rampWebhookURL?.trim() || target.url,
    registeredAt: registeredAt.toISOString(),
    secretSource: envSecret ? "env" : verificationSecret ? "stored" : "missing",
    secretHint: verificationSecret ? verificationSecret.slice(-4) : null,
  };
}

/**
 * Called before opening an order. Best-effort: an order must not fail because
 * webhook registration hiccupped — polling and the per-order webhookURL still
 * move it forward.
 */
export async function ensurePajWebhookRegistered(): Promise<void> {
  try {
    const env = getEnv();
    if (env.PAJ_CASH_WEBHOOK_SECRET) return; // operator manages the URL
    const target = getPajWebhookTarget();
    if (!target.public || !target.url) return;
    if (!autoRegisterAllowed()) return;

    const row = await prisma.pajWebhookConfig.findUnique({
      where: { id: CONFIG_ID },
      select: { rampWebhookUrl: true, secretCipher: true },
    });
    const hasUsableSecret = row?.secretCipher
      ? Boolean(openPajWebhookSecret(row.secretCipher))
      : false;

    if (row?.rampWebhookUrl === target.url && hasUsableSecret) return;

    const result = await registerPajWebhook();
    console.info("[paj] ramp webhook registered", {
      url: result.url,
      secretHint: result.secretHint,
    });
  } catch (err) {
    console.error(
      "[paj] couldn't register the ramp webhook; status polling still works",
      err
    );
  }
}

/** Ask Paj to POST a signed sample order to the registered endpoint. */
export async function sendPajWebhookTest(): Promise<PajWebhookTestResult> {
  const row = await prisma.pajWebhookConfig.findUnique({
    where: { id: CONFIG_ID },
    select: { rampWebhookUrl: true },
  });
  if (!row?.rampWebhookUrl) {
    throw new PajWebhookConfigError(
      "Connect the webhook first — Paj has no ramp URL on this key yet.",
      "PAJ_WEBHOOK_NOT_REGISTERED"
    );
  }

  try {
    return await testPajWebhook("RAMP");
  } catch (err) {
    throw new PajWebhookConfigError(
      err instanceof Error ? err.message : "Paj could not run the delivery test.",
      "PAJ_WEBHOOK_TEST_FAILED",
      502
    );
  }
}

export interface PajWebhookDiagnostics {
  target: PajWebhookTarget;
  autoRegister: boolean;
  secret: {
    source: "env" | "stored" | "missing";
    hint: string | null;
    /** null when we have never seen the key's real secret locally. */
    matchesProvider: boolean | null;
    error: string | null;
  };
  registration: {
    url: string | null;
    registeredAt: string | null;
    matchesTarget: boolean;
  };
  events: {
    last24h: number;
    failed24h: number;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: string | null;
  };
}

/** Everything the Settings → Webhooks page needs, with no secret material. */
export async function getPajWebhookDiagnostics(): Promise<PajWebhookDiagnostics> {
  const target = getPajWebhookTarget();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [row, active, failed, latest] = await Promise.all([
    prisma.pajWebhookConfig.findUnique({
      where: { id: CONFIG_ID },
      select: {
        rampWebhookUrl: true,
        secretCipher: true,
        secretHint: true,
        registeredAt: true,
      },
    }),
    prisma.webhookEvent.count({
      where: { source: "paj", createdAt: { gte: since } },
    }),
    prisma.webhookEvent.count({
      where: { source: "paj", createdAt: { gte: since }, status: "FAILED" },
    }),
    prisma.webhookEvent.findFirst({
      where: { source: "paj" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true },
    }),
  ]);

  const resolved = await getPajWebhookSecret();
  const providerSecret = row?.secretCipher
    ? openPajWebhookSecret(row.secretCipher)
    : null;

  const matchesProvider =
    resolved.secret && providerSecret ? resolved.secret === providerSecret : null;

  return {
    target,
    autoRegister: autoRegisterAllowed(),
    secret: {
      source: resolved.source === "none" ? "missing" : resolved.source,
      hint: resolved.secret ? resolved.secret.slice(-4) : row?.secretHint ?? null,
      matchesProvider,
      error: resolved.error,
    },
    registration: {
      url: row?.rampWebhookUrl ?? null,
      registeredAt: row?.registeredAt?.toISOString() ?? null,
      matchesTarget: Boolean(target.url && row?.rampWebhookUrl === target.url),
    },
    events: {
      last24h: active,
      failed24h: failed,
      lastDeliveryAt: latest?.createdAt.toISOString() ?? null,
      lastDeliveryStatus: latest?.status ?? null,
    },
  };
}
