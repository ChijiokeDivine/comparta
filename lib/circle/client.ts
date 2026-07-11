// lib/circle/client.ts
//
// Singleton wrapper around Circle's Developer-Controlled Wallets SDK.
//
// SECURITY NOTE — READ BEFORE TOUCHING THIS FILE:
// CIRCLE_ENTITY_SECRET is the single point of catastrophic failure for this
// entire product. Anyone who has it (plus your API key) can move every
// dollar sitting in every org's Arc wallet. It must:
//   - live only in your platform's secrets manager (Vercel/AWS/GCP secret
//     store, etc.), injected as an env var at runtime
//   - NEVER be committed to git, logged, returned from an API route, or
//     stored in Postgres in plaintext
//   - be paired with the recovery file you generated during entity-secret
//     registration (registerEntitySecretCiphertext) — store that file
//     offline/encrypted, it's your only recovery path if the secret is lost
//
// The SDK itself takes care of encrypting the entity secret into a fresh
// entitySecretCiphertext (RSA-encrypted against Circle's public key) on
// every single write call — you do not need to, and should not, roll your
// own ciphertext generation. That's handled inside
// initiateDeveloperControlledWalletsClient.

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { getEnv } from "@/lib/env";

type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

const globalForCircle = globalThis as unknown as {
  circleClient: CircleClient | undefined;
};

/**
 * Returns a memoized Circle Developer-Controlled Wallets client, configured
 * for whichever environment (sandbox/production) CIRCLE_ENVIRONMENT points
 * at. The underlying API key already encodes test vs. live
 * (TEST_API_KEY:... vs LIVE_API_KEY:...) so there is nothing else to switch
 * here — we just fail loudly if the two are inconsistent.
 */
export function getCircleClient(): CircleClient {
  if (globalForCircle.circleClient) return globalForCircle.circleClient;

  const env = getEnv();

  const looksLikeTestKey = env.CIRCLE_API_KEY.startsWith("TEST_API_KEY:");
  const looksLikeLiveKey = env.CIRCLE_API_KEY.startsWith("LIVE_API_KEY:");

  if (env.CIRCLE_ENVIRONMENT === "sandbox" && looksLikeLiveKey) {
    throw new Error(
      "CIRCLE_ENVIRONMENT=sandbox but CIRCLE_API_KEY looks like a LIVE key. Refusing to start."
    );
  }
  if (env.CIRCLE_ENVIRONMENT === "production" && looksLikeTestKey) {
    throw new Error(
      "CIRCLE_ENVIRONMENT=production but CIRCLE_API_KEY looks like a TEST key. Refusing to start."
    );
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });

  globalForCircle.circleClient = client;
  return client;
}

/** The Circle blockchain identifier Comparta settles on. */
export function getArcBlockchain(): "ARC-TESTNET" | "ARC" {
  return getEnv().ARC_CHAIN === "ARC_MAINNET" ? "ARC" : "ARC-TESTNET";
}
