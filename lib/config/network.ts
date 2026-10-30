// lib/config/network.ts
//
// Decides which Arc network this process talks to, and rewrites the
// environment so every downstream module keeps reading the SAME variable
// names it always has (CIRCLE_API_KEY, ARC_CHAIN, CIRCLE_ENVIRONMENT, …).
//
// WHY THIS EXISTS
// ---------------
// Comparta keeps testnet and mainnet credentials side by side in one secret
// store (Infisical → Vercel). ONLY the three Circle credentials (plus the RPC
// endpoints) are duplicated, suffixed `_MAIN` for mainnet:
//
//   CIRCLE_API_KEY          (testnet)   CIRCLE_API_KEY_MAIN          (mainnet)
//   CIRCLE_CLIENT_KEY       (testnet)   CIRCLE_CLIENT_KEY_MAIN       (mainnet)
//   CIRCLE_ENTITY_SECRET    (testnet)   CIRCLE_ENTITY_SECRET_MAIN    (mainnet)
//   ARC_TESTNET_RPC         (testnet)   ARC_MAINNET_RPC             (mainnet)
//
// Everything else (wallet set id, USDC token id, protocol deployment
// addresses, operator key) is SHARED config: it is read from the unsuffixed
// variable on both networks, with an optional `_MAIN` override if one is ever
// added. Blanking those on mainnet would silently drop a production
// wallet-set id / contract address and make the app provision a fresh wallet
// set or fail an on-chain call.
//
// Local dev + Vercel previews run testnet; a Vercel *production* deployment
// runs mainnet. Nothing in the app should branch on `VERCEL_ENV` itself —
// it asks this module instead, so there is exactly one place where a
// mainnet/testnet decision is made and exactly one place to audit it.
//
// SAFETY POSTURE (deliberate, do not soften):
//   - There is NO fallback from a missing `_MAIN` credential to the testnet
//     key in production. Silently running mainnet code against a sandbox key
//     (or vice versa) is worse than a failed deploy, so a missing key
//     surfaces as the existing "CIRCLE_API_KEY is required" env error.
//   - A key whose prefix contradicts the resolved network throws at startup
//     (`TEST_API_KEY:` on mainnet, `LIVE_API_KEY:` on testnet).
//   - `ARC_NETWORK=testnet|mainnet` is an explicit escape hatch, so you can
//     run a production build against testnet (or force mainnet in a
//     deliberate pre-cutover check) without editing code.

import {
  NETWORK_PROFILES,
  type AppNetwork,
  type NetworkProfile,
} from "./networkProfiles";

export * from "./networkProfiles";

export type EnvLike = Record<string, string | undefined>;
export type NetworkResolutionSource = "ARC_NETWORK" | "VERCEL_ENV" | "default";

const MAINNET_WORDS = new Set(["mainnet", "main", "production", "prod", "live"]);
const TESTNET_WORDS = new Set([
  "testnet",
  "test",
  "sandbox",
  "staging",
  "development",
  "dev",
  "preview",
]);

/** Credentials that exist in two network flavours, with NO fallback. */
const NETWORK_CREDENTIAL_VARS = [
  "CIRCLE_API_KEY",
  "CIRCLE_CLIENT_KEY",
  "CIRCLE_ENTITY_SECRET",
] as const;

/**
 * Config that is normally shared across networks, but may be overridden per
 * network with a `_MAIN` variant if one is ever added.
 */
const NETWORK_OVERRIDABLE_VARS = [
  "CIRCLE_APP_ID",
  "CIRCLE_USDC_TOKEN_ID",
  "CIRCLE_WALLET_SET_ID",
  "AGREEMENT_CORE_ADDRESS",
  "CONDITIONAL_MODULE_ADDRESS",
  "STREAM_MODULE_ADDRESS",
  "ONCHAIN_USDC_ADDRESS",
  "ONCHAIN_OPERATOR_PRIVATE_KEY",
] as const;

export interface NetworkResolution {
  network: AppNetwork;
  source: NetworkResolutionSource;
  /** Raw value that produced the decision, for logs/diagnostics. */
  decisionValue?: string;
}

function normalizeWord(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Resolves the active network WITHOUT throwing — safe to call from
 * next.config.ts, health checks, or anywhere that must not crash the build.
 *
 * Precedence:
 *   1. ARC_NETWORK (explicit override)
 *   2. VERCEL_ENV === "production"  → mainnet
 *   3. everything else              → testnet
 */
export function resolveNetwork(env: EnvLike = process.env): NetworkResolution {
  const explicit = normalizeWord(env.ARC_NETWORK ?? env.NEXT_PUBLIC_ARC_NETWORK);
  if (explicit) {
    if (MAINNET_WORDS.has(explicit)) {
      return { network: "mainnet", source: "ARC_NETWORK", decisionValue: explicit };
    }
    if (TESTNET_WORDS.has(explicit)) {
      return { network: "testnet", source: "ARC_NETWORK", decisionValue: explicit };
    }
    // Unknown value: fail loudly rather than silently picking a network.
    throw new Error(
      `ARC_NETWORK="${env.ARC_NETWORK}" is not recognised. Use "mainnet" or "testnet".`
    );
  }

  if (normalizeWord(env.VERCEL_ENV) === "production") {
    return { network: "mainnet", source: "VERCEL_ENV", decisionValue: env.VERCEL_ENV };
  }

  return { network: "testnet", source: "default", decisionValue: env.VERCEL_ENV };
}

export function resolveAppNetwork(env: EnvLike = process.env): AppNetwork {
  return resolveNetwork(env).network;
}

export function resolveNetworkProfile(env: EnvLike = process.env): NetworkProfile {
  return NETWORK_PROFILES[resolveAppNetwork(env)];
}

function readFirst(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value != null && value.trim() !== "") return value;
  }
  return undefined;
}

function apiKeyPrefix(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.startsWith("LIVE_API_KEY:")) return "live";
  if (trimmed.startsWith("TEST_API_KEY:")) return "test";
  return null;
}

/**
 * Returns a NEW env object with the active network's credentials mapped onto
 * the canonical variable names, plus the derived network facts
 * (APP_NETWORK, ARC_CHAIN, CIRCLE_ENVIRONMENT, ARC_RPC_URL).
 *
 * Throws on configuration that would be dangerous to run:
 *   - explicit ARC_CHAIN / CIRCLE_ENVIRONMENT contradicting the network
 *   - a test key in a mainnet process (or a live key in a testnet process)
 */
export function applyNetworkEnv(env: EnvLike = process.env): EnvLike {
  const { network } = resolveNetwork(env);
  const profile = NETWORK_PROFILES[network];
  const out: EnvLike = { ...env };

  // ── Derived facts ────────────────────────────────────────────────────
  out.APP_NETWORK = network;
  out.NEXT_PUBLIC_APP_NETWORK = network;

  const configuredChain = env.ARC_CHAIN?.trim();
  if (configuredChain && configuredChain !== profile.chain) {
    throw new Error(
      `ARC_CHAIN=${configuredChain} contradicts APP_NETWORK=${network} ` +
        `(expected ${profile.chain}). ARC_CHAIN is derived from ARC_NETWORK/VERCEL_ENV — ` +
        `remove the manual ARC_CHAIN override.`
    );
  }
  out.ARC_CHAIN = profile.chain;

  const configuredCircleEnv = env.CIRCLE_ENVIRONMENT?.trim();
  if (configuredCircleEnv && configuredCircleEnv !== profile.circleEnvironment) {
    throw new Error(
      `CIRCLE_ENVIRONMENT=${configuredCircleEnv} contradicts APP_NETWORK=${network} ` +
        `(expected ${profile.circleEnvironment}). CIRCLE_ENVIRONMENT is derived — ` +
        `remove the manual override.`
    );
  }
  out.CIRCLE_ENVIRONMENT = profile.circleEnvironment;

  // ── Credentials ──────────────────────────────────────────────────────
  // The three real credentials are strictly per-network: no fallback from
  // `_MAIN` to the sandbox value (or vice versa).
  for (const name of NETWORK_CREDENTIAL_VARS) {
    out[name] = profile.isMainnet
      ? readFirst(env[`${name}_MAIN`])
      : readFirst(env[name]);
  }

  // Shared config: unsuffixed value on both networks, with a `_MAIN`
  // override taking precedence if one is configured.
  for (const name of NETWORK_OVERRIDABLE_VARS) {
    out[name] = profile.isMainnet
      ? readFirst(env[`${name}_MAIN`], env[name])
      : readFirst(env[name]);
  }

  // RPC: accept both the documented `ARC_*_RPC` names and the older
  // `ARC_*_RPC_URL` names, then fall back to Circle's public endpoint.
  out.ARC_RPC_URL = profile.isMainnet
    ? readFirst(env.ARC_MAINNET_RPC, env.ARC_MAINNET_RPC_URL)
    : readFirst(env.ARC_TESTNET_RPC, env.ARC_TESTNET_RPC_URL);
  if (!out.ARC_RPC_URL) {
    out.ARC_RPC_URL = profile.rpcUrl;
  }
  // Keep the legacy names populated so lib/onchain/client.ts's existing
  // fallbacks (and any external scripts) keep working.
  out[profile.isMainnet ? "ARC_MAINNET_RPC_URL" : "ARC_TESTNET_RPC_URL"] = out.ARC_RPC_URL;

  // USDC contract address is the same predeploy on both networks, so a
  // sensible default beats a missing-env crash in the on-chain module.
  if (!out.ONCHAIN_USDC_ADDRESS) {
    out.ONCHAIN_USDC_ADDRESS = profile.usdcAddress;
  }

  // ── Fail loudly on a network/key mismatch ────────────────────────────
  const prefix = apiKeyPrefix(out.CIRCLE_API_KEY);
  if (profile.isMainnet && prefix === "test") {
    throw new Error(
      "Refusing to start: APP_NETWORK=mainnet but CIRCLE_API_KEY (from CIRCLE_API_KEY_MAIN) " +
        "is a TEST_API_KEY. Check that CIRCLE_API_KEY_MAIN in your secret store holds the live key."
    );
  }
  if (!profile.isMainnet && prefix === "live") {
    throw new Error(
      "Refusing to start: APP_NETWORK=testnet but CIRCLE_API_KEY is a LIVE_API_KEY. " +
        "Local/preview environments must use the sandbox key (CIRCLE_API_KEY)."
    );
  }

  return out;
}

/** True when the process is configured for mainnet. */
export function isMainnet(): boolean {
  return resolveAppNetwork() === "mainnet";
}

/**
 * Human-readable summary for startup logs / health endpoints. Never
 * includes any secret value.
 */
export function describeNetwork(env: EnvLike = process.env): {
  network: AppNetwork;
  source: NetworkResolutionSource;
  chain: string;
  circleEnvironment: string;
  rpcHost: string;
  usingMainnetCredentials: boolean;
} {
  const { network, source } = resolveNetwork(env);
  const profile = NETWORK_PROFILES[network];
  let rpcHost = "";
  try {
    rpcHost = new URL(
      (network === "mainnet"
        ? readFirst(env.ARC_MAINNET_RPC, env.ARC_MAINNET_RPC_URL)
        : readFirst(env.ARC_TESTNET_RPC, env.ARC_TESTNET_RPC_URL)) ?? profile.rpcUrl
    ).host;
  } catch {
    rpcHost = "(invalid RPC URL)";
  }
  return {
    network,
    source,
    chain: profile.chain,
    circleEnvironment: profile.circleEnvironment,
    rpcHost,
    usingMainnetCredentials:
      network === "mainnet"
        ? Boolean(readFirst(env.CIRCLE_API_KEY_MAIN))
        : Boolean(readFirst(env.CIRCLE_API_KEY)),
  };
}
