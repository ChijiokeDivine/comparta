// lib/onramp/config.ts
//
// Server-only Onramp configuration. This is the single place that decides
// whether the card/bank checkout is available and which Circle environment
// it talks to.
//
// Credentials
// -----------
// Onramp authenticates with a Circle API key. By default we reuse the
// active network's regular Circle key (CIRCLE_API_KEY, which
// lib/config/network.ts maps from CIRCLE_API_KEY_MAIN on mainnet). Set
// CIRCLE_ONRAMP_API_KEY if you want Onramp to use a dedicated key instead.
//
// Environment
// -----------
// Onramp has a sandbox and a production pair of endpoints. Comparta's
// network resolution already decides testnet vs mainnet once, so we derive
// the Onramp endpoints from the same decision instead of adding another
// switch that could drift:
//
//   testnet / local dev → api-test.circle.com + onramp-sandbox.arc.io
//   mainnet             → api.circle.com      + onramp.arc.io
//
// The client half of this pair lives in lib/config/clientChains.ts
// (ONRAMP_WIDGET_BASE_URL) and MUST agree with widgetBaseUrl here.

import { resolveAppNetwork } from "@/lib/config/network";
import { getEnv } from "@/lib/env";

export interface OnrampServerConfig {
  /** Circle API key. Server-only — never send this to the browser. */
  apiKey: string;
  /** Bare hostname allowed to embed the widget (no scheme/port/path). */
  referrerDomain?: string;
  /** wallets-api base URL for the active environment. */
  baseUrl: string;
  /** Hosted widget origin for the active environment. */
  widgetBaseUrl: string;
}

const SANDBOX_BASE_URL = "https://api-test.circle.com";
const SANDBOX_WIDGET_BASE_URL = "https://onramp-sandbox.arc.io";
const PRODUCTION_BASE_URL = "https://api.circle.com";
const PRODUCTION_WIDGET_BASE_URL = "https://onramp.arc.io";

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    // URL#hostname strips the scheme and, importantly, the port — Onramp
    // requires a bare hostname (`localhost`, not `localhost:3000`).
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
}

function onrampDisabled(flag: string | undefined): boolean {
  const value = (flag ?? "").trim().toLowerCase();
  return value === "false" || value === "0" || value === "off" || value === "no";
}

/**
 * Returns the Onramp server config, or null when Onramp is explicitly
 * disabled or no API key is available. Callers should treat null as
 * "the checkout entry point should not be shown".
 */
export function getOnrampServerConfig(): OnrampServerConfig | null {
  const env = getEnv();

  if (onrampDisabled(env.ONRAMP_ENABLED)) return null;

  const apiKey = (env.CIRCLE_ONRAMP_API_KEY?.trim() || env.CIRCLE_API_KEY).trim();
  if (!apiKey) return null;

  const isMainnet = resolveAppNetwork() === "mainnet";

  return {
    apiKey,
    referrerDomain:
      env.ONRAMP_REFERRER_DOMAIN?.trim() || hostnameOf(env.NEXTAUTH_URL),
    baseUrl: isMainnet ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL,
    widgetBaseUrl: isMainnet ? PRODUCTION_WIDGET_BASE_URL : SANDBOX_WIDGET_BASE_URL,
  };
}

/**
 * Non-throwing availability check for server components. Configuration
 * errors must not take the whole page down just to hide a deposit method.
 */
export function isOnrampEnabled(): boolean {
  try {
    return getOnrampServerConfig() !== null;
  } catch (err) {
    console.warn("[onramp] config check failed", err);
    return false;
  }
}
