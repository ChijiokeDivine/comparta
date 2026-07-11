// lib/circle/webhookVerify.ts
//
// Verifies the X-Circle-Signature header on inbound webhook POSTs.
//
// Flow (per Circle's docs):
//   1. The webhook request carries X-Circle-Key-Id and X-Circle-Signature.
//   2. GET https://api.circle.com/v2/notifications/publicKey/{keyId} to
//      fetch the DER-encoded, base64 public key + algorithm (ECDSA_SHA_256)
//      used to sign that specific key id. Public keys are static per
//      keyId, so we cache them in-process.
//   3. Verify X-Circle-Signature against the *raw* request body bytes
//      (not a re-serialized JSON.stringify — whitespace differences break
//      the signature) using that public key.
//
// Never trust a webhook payload before this passes. The API route stores
// the raw body either way (see app/api/webhooks/circle/route.ts) so a
// forged or malformed request is never silently lost, but it must never be
// *processed* as trusted data without signatureOk === true.

import { createVerify } from "node:crypto";
import { getEnv } from "@/lib/env";

const publicKeyCache = new Map<string, { publicKeyPem: string; algorithm: string }>();

function derBase64ToPem(publicKeyBase64: string): string {
  const lines = publicKeyBase64.match(/.{1,64}/g) ?? [publicKeyBase64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

async function fetchCirclePublicKey(
  keyId: string
): Promise<{ publicKeyPem: string; algorithm: string }> {
  const cached = publicKeyCache.get(keyId);
  if (cached) return cached;

  const env = getEnv();
  const url = `${env.CIRCLE_WEBHOOK_PUBLIC_KEY_URL}/${encodeURIComponent(keyId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.CIRCLE_API_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch Circle notification public key (${res.status}) for keyId=${keyId}`
    );
  }

  const body = (await res.json()) as {
    data?: { algorithm?: string; publicKey?: string };
  };

  const algorithm = body.data?.algorithm;
  const publicKeyBase64 = body.data?.publicKey;
  if (!algorithm || !publicKeyBase64) {
    throw new Error(`Malformed public key response from Circle for keyId=${keyId}`);
  }

  const entry = { publicKeyPem: derBase64ToPem(publicKeyBase64), algorithm };
  publicKeyCache.set(keyId, entry);
  return entry;
}

export interface WebhookVerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * @param rawBody   The exact raw request body bytes/string as received —
 *                  do NOT pass a re-stringified/parsed-then-stringified
 *                  version, the signature won't match.
 * @param keyId     Value of the X-Circle-Key-Id header.
 * @param signature Value of the X-Circle-Signature header (base64).
 */
export async function verifyCircleWebhookSignature(
  rawBody: string,
  keyId: string | null,
  signature: string | null
): Promise<WebhookVerifyResult> {
  if (!keyId || !signature) {
    return { ok: false, reason: "Missing X-Circle-Key-Id or X-Circle-Signature header" };
  }

  try {
    const { publicKeyPem, algorithm } = await fetchCirclePublicKey(keyId);

    if (algorithm !== "ECDSA_SHA_256") {
      return { ok: false, reason: `Unsupported signature algorithm: ${algorithm}` };
    }

    const verifier = createVerify("SHA256");
    verifier.update(rawBody, "utf8");
    verifier.end();

    const isValid = verifier.verify(publicKeyPem, signature, "base64");
    return isValid ? { ok: true } : { ok: false, reason: "Signature mismatch" };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Unknown verification error",
    };
  }
}
