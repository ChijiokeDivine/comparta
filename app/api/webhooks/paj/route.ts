// app/api/webhooks/paj/route.ts
//
// Paj posts the whole order here on every status transition (INIT →
// PROCESSING → COMPLETED/ERROR). There is no delivery id, and failed
// deliveries are retried with a fresh signature.
//
// Order of operations:
//   1. Read the RAW body (signature verification is byte-sensitive)
//   2. Resolve the signing secret (env override, else the secret stored when
//      the endpoint was registered with Paj)
//   3. Verify X-PAJ-Timestamp / X-PAJ-Signature
//   4. Persist the delivery unconditionally, deduped by a hash of its bytes
//   5. Apply it to the local order (forward-only, compare-and-swap)
//
// Money safety:
//   - Unverified payloads are stored but NEVER applied
//   - Retries cannot re-apply a transition (dedupeKey is unique per source)
//   - Terminal orders are never overwritten by a late or out-of-order event
//   - Onramp USDC is credited by the Circle inbound webhook, not here; offramp
//     USDC was already debited by sendPayment() before Paj reported anything
//   - A 2xx is returned once the delivery is durably stored, so Paj does not
//     retry-storm on an unknown/duplicate order

import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { applyPajOrderWebhook } from "@/lib/paj/service";
import type { PajOrderWebhookPayload } from "@/lib/paj/types";
import {
  pajDeliveryFingerprint,
  verifyPajWebhookSignature,
} from "@/lib/paj/webhook";
import { getPajWebhookSecret } from "@/lib/paj/webhookConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Liveness probe for humans and uptime checks; Paj only ever POSTs. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "paj-ramp-webhook",
    accepts: "POST",
    signed: true,
  });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-paj-timestamp");
  const signature = req.headers.get("x-paj-signature");

  const resolvedSecret = await getPajWebhookSecret();
  const secretConfigured = Boolean(resolvedSecret.secret);
  const verification = verifyPajWebhookSignature({
    rawBody,
    timestamp,
    signature,
    secret: resolvedSecret.secret ?? undefined,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isRecord(parsed) || typeof parsed.id !== "string" || !parsed.id) {
    return NextResponse.json({ error: "Missing order id" }, { status: 400 });
  }

  const payload = parsed as unknown as PajOrderWebhookPayload;
  const dedupeKey = pajDeliveryFingerprint(rawBody);
  const eventType = [
    typeof payload.transactionType === "string" ? payload.transactionType : "RAMP",
    typeof payload.status === "string" ? payload.status : "UNKNOWN",
  ].join(" ");

  const baseData = {
    source: "paj",
    eventType,
    signatureOk: verification.ok,
    rawPayload: payload as unknown as Prisma.InputJsonValue,
    dedupeKey,
  };

  let event: { id: string };
  try {
    event = await prisma.webhookEvent.create({
      data: { ...baseData, status: "RECEIVED" },
      select: { id: true },
    });
  } catch (err) {
    if (!isPrismaUniqueViolation(err)) throw err;

    const existing = await prisma.webhookEvent.findUnique({
      where: { source_dedupeKey: { source: "paj", dedupeKey } },
      select: { id: true, signatureOk: true },
    });
    if (!existing) {
      // Should be unreachable: a unique violation implies a stored row.
      return NextResponse.json({ error: "Delivery conflict" }, { status: 500 });
    }
    if (existing.signatureOk) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (!verification.ok) {
      // Still unverified (e.g. the secret was added but Paj retried with the
      // old failed signature). Keep the original row untouched.
      return NextResponse.json(
        { ok: true, ignored: true, reason: verification.reason },
        { status: secretConfigured ? 401 : 202 }
      );
    }
    // First attempt landed before the secret existed; this retry verifies.
    // Upgrade the stored delivery instead of applying it twice.
    await prisma.webhookEvent.update({
      where: { id: existing.id },
      data: { signatureOk: true, status: "RECEIVED", processError: null },
    });
    event = existing;
  }

  if (!verification.ok) {
    const reason =
      verification.reason ??
      resolvedSecret.error ??
      "Signature verification failed.";
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        processedAt: new Date(),
        processError: reason,
      },
    });
    console.warn("[paj/webhook] rejected an unverified delivery", {
      webhookEventId: event.id,
      reason,
    });
    // With a secret configured, 401 makes Paj retry — useful if our secret
    // was briefly wrong. Without one, 202 stops the retry storm and polling
    // remains the source of truth.
    return NextResponse.json(
      { ok: true, ignored: true, reason },
      { status: secretConfigured ? 401 : 202 }
    );
  }

  try {
    const result = await applyPajOrderWebhook(payload);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        processError:
          result.ignoredReason ??
          (result.matched ? null : "No local order matches this id."),
      },
    });
    return NextResponse.json({
      ok: true,
      applied: result.changed,
      orderId: result.orderId ?? null,
    });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        processedAt: new Date(),
        processError:
          err instanceof Error ? err.message : "Processing failed.",
      },
    });
    console.error("[paj/webhook] processing failed", err);
    // 500 asks Paj to retry; the stored row is already durable.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
