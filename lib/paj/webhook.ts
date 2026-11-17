// lib/paj/webhook.ts
//
// Verifies Paj webhook signatures: HMAC-SHA256 over
// `{X-PAJ-Timestamp}.{raw body}`, hex encoded, prefixed `v1=` in the
// header. The raw body MUST be verified before JSON parsing — re-serialised
// JSON is different bytes and verifies only intermittently.
//
// Header shapes handled:
//   X-PAJ-Signature: v1=<64 hex>
//   X-PAJ-Signature: v1=<64 hex>, v1=<64 hex>   (scheme transition)
//   X-PAJ-Signature: <64 hex>                   (legacy bare digest)
// Other schemes (e.g. a future `v2=`) are ignored rather than treated as a
// digest, matching Paj's documented prefix rule.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 300;
const HEX_DIGEST = /^[0-9a-f]{64}$/i;

export interface PajWebhookVerification {
  ok: boolean;
  reason?: string;
}

/** Candidate v1 digests in a signature header, in header order. */
export function extractPajSignatures(header: string | null): string[] {
  if (!header) return [];
  const tokens = header
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const v1 = tokens
    .filter((token) => token.toLowerCase().startsWith("v1="))
    .map((token) => token.slice("v1=".length).trim())
    .filter(Boolean);
  if (v1.length > 0) return v1;

  // Legacy/bare form: only accept it when it is unambiguously a digest.
  return tokens.length === 1 && HEX_DIGEST.test(tokens[0]) ? tokens : [];
}

export function verifyPajWebhookSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
}): PajWebhookVerification {
  const { rawBody, timestamp, signature, secret } = input;

  if (!secret) {
    // No secret available: the delivery can't be authenticated. The caller
    // records it but relies on polling for state. Never treat this as
    // verified.
    return { ok: false, reason: "Webhook secret is not configured." };
  }
  if (!timestamp || !signature) {
    return { ok: false, reason: "Missing signature headers." };
  }
  if (!/^\d{1,12}$/.test(timestamp.trim())) {
    return { ok: false, reason: "Invalid timestamp." };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "Invalid timestamp." };
  }
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "Timestamp is outside the replay window." };
  }

  const candidates = extractPajSignatures(signature);
  if (candidates.length === 0) {
    return { ok: false, reason: "No v1 signature found." };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");

  for (const candidate of candidates) {
    if (!HEX_DIGEST.test(candidate)) continue;
    const receivedBytes = Buffer.from(candidate, "hex");
    if (
      receivedBytes.length === expectedBytes.length &&
      timingSafeEqual(receivedBytes, expectedBytes)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "Invalid signature." };
}

/**
 * Stable fingerprint of a delivery's exact bytes. Paj has no delivery id and
 * retries resend the same body, so this is the dedupe key for webhook_events.
 */
export function pajDeliveryFingerprint(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
