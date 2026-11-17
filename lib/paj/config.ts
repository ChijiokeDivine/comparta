// lib/paj/config.ts
//
// Server-side Paj configuration: environment, API host, enabled chain
// mapping and the safety gate that prevents a testnet wallet from ever
// creating a mainnet order (or vice versa).
//
// All endpoint calls live in lib/paj/client.ts + lib/paj/api.ts.

import type { Chain } from "@/app/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { resolveAppNetwork } from "@/lib/config/network";
import {
  getPajChain,
  type PajChainId,
  type PajChainOption,
} from "@/lib/config/pajChains";

/**
 * Paj environment → Comparta network pairing. Kept deliberately strict:
 * a production Paj key may only be used from a mainnet deployment, and a
 * staging key only from a testnet deployment. This is what stops a local
 * (Arc testnet) demo from delivering real mainnet USDC to a throwaway
 * address.
 */
export function getPajEnvironment(): "production" | "staging" {
  return getEnv().PAJ_CASH_ENVIRONMENT;
}

export function isPajConfigured(): boolean {
  return Boolean(getEnv().PAJ_CASH_API_KEY);
}

export function getPajApiBaseUrl(): string {
  return getPajEnvironment() === "staging"
    ? "https://api-staging.paj.cash"
    : "https://api.paj.cash";
}

export interface PajWebhookTarget {
  /** Absolute URL, or null when none could be built. */
  url: string | null;
  source: "env" | "derived" | "none";
  /** True only when Paj could realistically deliver to it. */
  public: boolean;
  reason: string | null;
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /\.local$/,
  /\.internal$/,
];

/**
 * Classify a candidate webhook URL. Paj needs a final absolute https URL:
 * it does not follow redirects, so an http→https redirect counts as a failed
 * delivery, and obviously it cannot reach localhost.
 */
export function assessPajWebhookUrl(raw: string | null | undefined): {
  url: string | null;
  public: boolean;
  reason: string | null;
} {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { url: null, public: false, reason: "No webhook URL is configured." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      url: null,
      public: false,
      reason: "The webhook URL is not a valid absolute URL.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      url: trimmed,
      public: false,
      reason: "Paj only delivers to an https URL (redirects are not followed).",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    return {
      url: trimmed,
      public: false,
      reason:
        "That hostname is not reachable from the internet. Use a public https URL or a tunnel.",
    };
  }

  return { url: trimmed, public: true, reason: null };
}

/**
 * The endpoint Paj should post ramp updates to.
 *
 * PAJ_WEBHOOK_URL is the explicit override; otherwise the app derives it from
 * NEXTAUTH_URL. A derived localhost URL is not "configured" — it is reported
 * as unreachable so the UI can explain why deliveries never arrive.
 */
export function getPajWebhookTarget(): PajWebhookTarget {
  const env = getEnv();
  const explicit = env.PAJ_WEBHOOK_URL?.trim();
  const base = env.NEXTAUTH_URL ?? "http://localhost:3000";
  const derived = `${base.replace(/\/$/, "")}/api/webhooks/paj`;
  const assessed = assessPajWebhookUrl(explicit || derived);

  return {
    ...assessed,
    source: explicit ? "env" : "derived",
  };
}

/**
 * URL to attach to an order at creation time, or null to let the API key's
 * registered `rampWebhookURL` handle it. Never returns an unreachable URL —
 * Paj would accept it and silently deliver nowhere.
 */
export function getPajWebhookUrl(): string | null {
  const target = getPajWebhookTarget();
  return target.public ? target.url : null;
}

/**
 * Arc is the only enabled chain today. When a new Comparta wallet chain
 * gains Paj support, add it here and flip `enabled` in
 * lib/config/pajChains.ts — no other module hardcodes a chain.
 */
const PAJ_CHAIN_BY_WALLET_CHAIN: Partial<Record<Chain, PajChainId>> = {
  ARC_MAINNET: "ARC",
  ARC_TESTNET: "ARC",
};

export function isWalletChainCompatible(): boolean {
  const appIsMainnet = resolveAppNetwork() === "mainnet";
  const pajIsProduction = getPajEnvironment() === "production";
  return appIsMainnet === pajIsProduction;
}

/** Paj settlement chain for a Comparta wallet chain, or null if unsupported. */
export function getPajChainForWallet(chain: Chain | null | undefined): PajChainOption | null {
  if (!chain) return null;
  const pajChainId = PAJ_CHAIN_BY_WALLET_CHAIN[chain];
  if (!pajChainId) return null;
  const option = getPajChain(pajChainId);
  if (!option || !option.enabled) return null;
  if (!isWalletChainCompatible()) return null;
  return option;
}

/**
 * Short, user-facing reason the bank ramp is unavailable. Null means
 * available. Keep these to one line — the UI renders them inline.
 */
export function getPajUnavailableReason(
  chain: Chain | null | undefined
): string | null {
  if (!isPajConfigured()) return "Bank transfers aren't configured yet.";
  if (!chain) return "Create a wallet first.";
  if (!getPajChainForWallet(chain)) {
    if (!isWalletChainCompatible()) {
      return "Bank transfers are unavailable: Paj is configured for a different network.";
    }
    return "Bank transfers are available on Arc only.";
  }
  return null;
}
