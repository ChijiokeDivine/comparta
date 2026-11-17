// lib/paj/secretBox.ts
//
// Small AES-256-GCM box for the Paj webhook signing secret, so a database
// dump alone cannot be used to forge deliveries. The key is derived from
// PAJ_CASH_API_KEY, which lives in the environment, not the database.
//
// This is deliberately not a general-purpose secret store: it exists for one
// field, with one key source, and returns null instead of throwing so a
// rotated API key degrades to "re-register" rather than a broken deploy.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

const VERSION = "v1";
const IV_BYTES = 12;

function boxKey(): Buffer | null {
  const apiKey = getEnv().PAJ_CASH_API_KEY;
  if (!apiKey) return null;
  return createHash("sha256").update(`comparta:paj-webhook:${apiKey}`).digest();
}

export function sealPajWebhookSecret(secret: string): string | null {
  const key = boxKey();
  if (!key || !secret) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function openPajWebhookSecret(sealed: string): string | null {
  const key = boxKey();
  if (!key || !sealed) return null;

  const [version, ivPart, tagPart, ciphertextPart] = sealed.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivPart, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}
