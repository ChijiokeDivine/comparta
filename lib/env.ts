// lib/env.ts
// Centralized, typed access to environment variables. Import this instead of
// reading process.env directly anywhere else in the codebase, so a missing
// var fails loudly and in one place instead of silently as `undefined`
// three files deep into a Circle API call.

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  NEXTAUTH_URL: z.string().min(1, "NEXTAUTH_URL is required"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),

  // Circle Developer-Controlled Wallets
  CIRCLE_API_KEY: z.string().min(1, "CIRCLE_API_KEY is required"),
  CIRCLE_CLIENT_KEY: z.string().optional(),
  // NOTE: this env var should point at a value pulled from a secrets
  // manager at deploy time (e.g. injected by your platform's secret store),
  // not a plaintext .env committed anywhere. See lib/circle/entitySecret.ts
  // for why this is the single point of catastrophic failure if leaked.
  CIRCLE_ENTITY_SECRET: z.string().min(1, "CIRCLE_ENTITY_SECRET is required"),
  CIRCLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),

  // Optional: id of a pre-created Circle Wallet Set to provision wallets
  // from. If unset, wallets/create will lazily create one wallet set and
  // you should persist its id back into this var.
  CIRCLE_WALLET_SET_ID: z.string().optional(),

  ARC_CHAIN: z.enum(["ARC_TESTNET", "ARC_MAINNET"]).default("ARC_TESTNET"),

  // Circle's published public-key endpoint for webhook signature verification.
  CIRCLE_WEBHOOK_PUBLIC_KEY_URL: z
    .string()
    .default("https://api.circle.com/v2/notifications/publicKey"),

  // Shared secret gating the manual KYB-approval stub endpoint
  // (/api/org/kyb/approve). Replace this whole flow once a real KYB
  // provider is integrated.
  ADMIN_API_SECRET: z.string().min(1, "ADMIN_API_SECRET is required"),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid/missing environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
