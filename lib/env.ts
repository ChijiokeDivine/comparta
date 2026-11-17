// lib/env.ts
// Centralized, typed access to environment variables. Import this instead of
// reading process.env directly anywhere else in the codebase, so a missing
// var fails loudly and in one place instead of silently as `undefined`
// three files deep into a Circle (or Groq) API call.

import { z } from "zod";
import { applyNetworkEnv, resolveNetwork, type AppNetwork } from "@/lib/config/network";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // Local-dev escape hatch: "true"/"1" runs the app without Redis. Rate
  // limiting and the yield-rate cache fall back to in-process memory,
  // realtime stays single-process, and background job enqueues are skipped
  // with a warning. Never enable in production.
  REDIS_DISABLED: z.string().optional(),

  NEXTAUTH_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Which Arc network this process runs against. Derived from
  // ARC_NETWORK / VERCEL_ENV by lib/config/network.ts — do not set by hand.
  APP_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),

  // Circle Developer-Controlled Wallets. These canonical names are filled
  // in from the network-specific variables (…_MAIN on mainnet) by
  // lib/config/network.ts#applyNetworkEnv before validation.
  CIRCLE_API_KEY: z.string().min(1, "CIRCLE_API_KEY is required"),
  CIRCLE_APP_ID: z.string().optional(),
  CIRCLE_CLIENT_KEY: z.string().optional(),
  // NOTE: this env var should point at a value pulled from a secrets
  // manager at deploy time (e.g. injected by your platform's secret store),
  // not a plaintext .env committed anywhere. See lib/circle/entitySecret.ts
  // for why this is the single point of catastrophic failure if leaked.
  CIRCLE_ENTITY_SECRET: z.string().min(1, "CIRCLE_ENTITY_SECRET is required"),
  CIRCLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  // TokenId of USDC on Arc (for the wallet chain we use for transfers).
  // If not set, lib/circle/wallets.ts will attempt to look it up per-wallet
  // from the Circle token-balances endpoint - but that's slow and flaky on
  // Arc testnet, so always prefer setting this explicitly.
  CIRCLE_USDC_TOKEN_ID: z.string().optional(),

  // Optional: id of a pre-created Circle Wallet Set to provision wallets
  // from. If unset, wallets/create will lazily create one wallet set and
  // you should persist its id back into this var.
  CIRCLE_WALLET_SET_ID: z.string().optional(),

  // ── Onramp (App Kit) ────────────────────────────────────────────────
  // "true" (default) / "false". Set to "false" to hide the card & bank
  // checkout everywhere without removing the integration.
  ONRAMP_ENABLED: z.string().optional(),
  // Optional DEDICATED Circle API key for Onramp. When unset, the active
  // network's regular CIRCLE_API_KEY is used (CIRCLE_API_KEY_MAIN on
  // mainnet, thanks to lib/config/network.ts).
  CIRCLE_ONRAMP_API_KEY: z.string().optional(),
  // Bare hostname allowed to embed the widget, e.g. "app.comparta.io".
  // Defaults to the hostname of NEXTAUTH_URL. Never derive this from a
  // request Origin/Referer header.
  ONRAMP_REFERRER_DOMAIN: z.string().optional(),

  ARC_CHAIN: z.enum(["ARC_TESTNET", "ARC_MAINNET"]).default("ARC_TESTNET"),

  // Circle's published public-key endpoint for webhook signature verification.
  CIRCLE_WEBHOOK_PUBLIC_KEY_URL: z
    .string()
    .default("https://api.circle.com/v2/notifications/publicKey"),

  // ── Paj Cash (Nigerian bank onramp / offramp) ────────────────────────
  // Optional so the app boots without it; the bank ramp UI hides itself
  // when no key is present. Server-side only — never expose this key to
  // the browser. The key is scoped to the business and the rates it
  // returns already include that business's fee.
  PAJ_CASH_API_KEY: z.string().optional(),
  // Selects the Paj API host. "production" (default) pairs with Arc
  // mainnet; "staging" pairs with Arc testnet, so a testnet deployment
  // can never accidentally create a real-money order.
  PAJ_CASH_ENVIRONMENT: z.enum(["production", "staging"]).default("production"),
  // HMAC secret from the Paj dashboard (starts with "whsec_"). Verifies
  // X-PAJ-Signature on /api/webhooks/paj. Optional: when unset, Comparta
  // obtains the key's secret by registering the webhook (PATCH
  // /pub/v2/webhook) and stores it encrypted in PajWebhookConfig. Set this
  // only to override that, e.g. when the key is managed elsewhere.
  PAJ_CASH_WEBHOOK_SECRET: z.string().optional(),
  // Public URL Paj posts order updates to. Defaults to
  // ${NEXTAUTH_URL}/api/webhooks/paj. Must be the final https URL — Paj
  // does not follow redirects, and localhost/non-https URLs are rejected
  // as unreachable.
  PAJ_WEBHOOK_URL: z.string().url().optional(),
  // Point the API key's ramp webhook at PAJ_WEBHOOK_URL (or the derived
  // URL) automatically before opening an order. Runs on mainnet, or
  // whenever PAJ_WEBHOOK_URL is explicitly set; also available as a manual
  // action in Settings → Webhooks. Set to "false" to disable.
  PAJ_CASH_WEBHOOK_AUTO_REGISTER: z.enum(["true", "false"]).default("true"),

  // Shared secret gating the manual KYB-approval stub endpoint
  // (/api/org/kyb/approve). Replace this whole flow once a real KYB
  // provider is integrated.
  ADMIN_API_SECRET: z.string().min(1, "ADMIN_API_SECRET is required"),

  // Phase 9 - Spending Insights. Groq-hosted LLM inference (OpenAI-
  // compatible chat completions via the `groq-sdk` package) - used for
  // transaction categorization suggestions and natural-language query
  // translation. See lib/groq/client.ts. Only transaction METADATA
  // (amounts, memos, display names, dates) is ever sent to this API -
  // never raw addresses, account numbers, or entity secrets. Get a key
  // at https://console.groq.com.
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),

  // On-chain protocol deployment addresses. Record these after a real
  // broadcast (never invent addresses). See lib/docs/ONCHAIN_ARCHITECTURE.md
  // section 18 for the Hardhat deploy flow.
  AGREEMENT_CORE_ADDRESS: z.string().optional(),
  CONDITIONAL_MODULE_ADDRESS: z.string().optional(),
  STREAM_MODULE_ADDRESS: z.string().optional(),
  ONCHAIN_USDC_ADDRESS: z.string().optional(),

  // EVM RPC endpoint for the ACTIVE Arc network (resolved from
  // ARC_MAINNET_RPC / ARC_TESTNET_RPC by lib/config/network.ts).
  ARC_RPC_URL: z.string().url().optional(),
  // Legacy aliases kept for scripts that read them directly.
  ARC_TESTNET_RPC_URL: z.string().optional(),
  ARC_MAINNET_RPC_URL: z.string().optional(),

  // Operator wallet used by the backend to submit protocol transactions.
  // In production, prefer Circle contract interaction or an HSM-backed
  // signer; the raw PK path is for testnet only.
  ONCHAIN_OPERATOR_PRIVATE_KEY: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parses the environment for the ACTIVE network. The raw process.env is
 * first normalised by lib/config/network.ts#applyNetworkEnv, which maps the
 * network-specific credentials (e.g. CIRCLE_API_KEY_MAIN on mainnet) onto
 * the canonical names used everywhere below.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const normalized = applyNetworkEnv(process.env);
  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    const network = resolveNetwork(process.env).network;
    const hint =
      network === "mainnet"
        ? " (APP_NETWORK=mainnet reads CIRCLE_API_KEY_MAIN / CIRCLE_ENTITY_SECRET_MAIN — " +
          "set those in the production environment, or set ARC_NETWORK=testnet to stay on sandbox)"
        : "";
    throw new Error(`Invalid/missing environment variables${hint}:\n${issues}`);
  }

  const nextauthUrl =
    (parsed.data.NEXTAUTH_URL?.startsWith("http")
      ? parsed.data.NEXTAUTH_URL
      : undefined) ??
    (parsed.data.VERCEL_URL
      ? `https://${parsed.data.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : undefined) ??
    "http://localhost:3000";

  cached = {
    ...parsed.data,
    NEXTAUTH_URL: nextauthUrl,
  };
  return cached;
}

/** The Arc network this server process is configured for. */
export function getAppNetwork(): AppNetwork {
  return getEnv().APP_NETWORK;
}