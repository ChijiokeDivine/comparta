// lib/circle/usyc.ts
//
// Thin wrapper over Circle's USYC (tokenized money-market fund) API — a
// DIFFERENT product surface from the Developer-Controlled Wallets SDK
// (lib/circle/wallets.ts) and the Payments API (lib/circle/payments.ts).
// USYC lets a Comparta-custodied wallet convert idle USDC into USYC
// (which earns yield via NAV appreciation, not rebasing — see
// YieldPosition's schema comment) and redeem back to USDC on demand.
//
// NOTE ON API SHAPE: this targets Circle's USYC conversion/order and
// NAV/yield-rate endpoints. Adjust the request bodies / response parsing
// below if your Circle account is provisioned against a different USYC
// integration surface — this file is the one place that request/response
// shape is assembled, matching the posture of lib/circle/payments.ts.
//
// Idempotency: every conversion call takes an idempotencyKey, deduplicated
// by Circle the same way createTransaction and hosted-checkout creation
// are deduplicated elsewhere in this codebase — safe to retry a timed-out
// request with the same key.
//
// Caching: getUsycNav() / getUsycYieldRate() hit Circle's API directly on
// every call. NEVER call them from a request handler or a per-page-load
// code path — always go through lib/savings/yieldRate.ts's short-TTL
// Redis-backed cache instead, or a busy dashboard will hammer Circle's
// API on every single page load.

import { getEnv } from "@/lib/env";

export class CircleUsycApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CircleUsycApiError";
  }
}

const CIRCLE_USYC_API_BASE = "https://api.circle.com/v1/usyc";

export type UsycConversionDirection = "USDC_TO_USYC" | "USYC_TO_USDC";

export interface CreateUsycConversionInput {
  /** Circle wallet id holding the funds. */
  walletId: string;
  direction: UsycConversionDirection;
  /** Decimal string, in the SOURCE token's units — USDC for USDC_TO_USYC, USYC for USYC_TO_USDC. */
  amount: string;
  idempotencyKey: string;
}

export interface UsycConversionResult {
  circleConversionId: string;
  state: string; // e.g. PENDING | PROCESSING | COMPLETE | FAILED
}

/** Submits a USDC<->USYC conversion order. Does not wait for settlement — poll getUsycConversionStatus (or let jobs/confirmYieldRedemption.ts do it) for the terminal outcome. */
export async function createUsycConversion(
  input: CreateUsycConversionInput
): Promise<UsycConversionResult> {
  const env = getEnv();

  const res = await fetch(`${CIRCLE_USYC_API_BASE}/conversions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.CIRCLE_API_KEY}`,
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      walletId: input.walletId,
      direction: input.direction,
      amount: input.amount,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CircleUsycApiError(
      `Circle USYC API returned ${res.status} creating a conversion`,
      body
    );
  }

  const json = (await res.json()) as { data?: { id?: string; state?: string } };
  const circleConversionId = json.data?.id;
  if (!circleConversionId) {
    throw new CircleUsycApiError("Circle USYC API returned no usable conversion id");
  }

  return { circleConversionId, state: json.data?.state ?? "PENDING" };
}

export interface UsycConversionStatus {
  circleConversionId: string;
  state: string;
  /** Populated once settled — decimal string, the DESTINATION token amount actually delivered. */
  settledAmount?: string;
  /** NAV applied to this conversion (USDC per whole USYC), decimal string. */
  navApplied?: string;
}

/** Fetches current status directly — used by jobs/confirmYieldRedemption.ts's poller and as a fallback if a webhook is missed/delayed. */
export async function getUsycConversionStatus(
  circleConversionId: string
): Promise<UsycConversionStatus> {
  const env = getEnv();

  const res = await fetch(
    `${CIRCLE_USYC_API_BASE}/conversions/${encodeURIComponent(circleConversionId)}`,
    { headers: { authorization: `Bearer ${env.CIRCLE_API_KEY}` } }
  );

  if (!res.ok) {
    throw new CircleUsycApiError(
      `Circle USYC API returned ${res.status} fetching conversion status`
    );
  }

  const json = (await res.json()) as {
    data?: { id?: string; state?: string; settledAmount?: string; nav?: string };
  };

  if (!json.data?.id || !json.data?.state) {
    throw new CircleUsycApiError(
      `Malformed USYC conversion status response for ${circleConversionId}`
    );
  }

  return {
    circleConversionId: json.data.id,
    state: json.data.state,
    settledAmount: json.data.settledAmount,
    navApplied: json.data.nav,
  };
}

export interface UsycNav {
  /** Decimal string, USDC per whole USYC token, e.g. "1.05123456". */
  navPerShare: string;
  asOf: Date;
}

/** Current NAV. Callers: lib/savings/yieldRate.ts's cache ONLY — see file header. */
export async function getUsycNav(): Promise<UsycNav> {
  const env = getEnv();

  const res = await fetch(`${CIRCLE_USYC_API_BASE}/nav`, {
    headers: { authorization: `Bearer ${env.CIRCLE_API_KEY}` },
  });

  if (!res.ok) {
    throw new CircleUsycApiError(`Circle USYC API returned ${res.status} fetching NAV`);
  }

  const json = (await res.json()) as { data?: { navPerShare?: string; asOf?: string } };
  if (!json.data?.navPerShare) {
    throw new CircleUsycApiError("Circle USYC API returned no NAV data");
  }

  return {
    navPerShare: json.data.navPerShare,
    asOf: json.data.asOf ? new Date(json.data.asOf) : new Date(),
  };
}

export interface UsycYieldRate {
  /** Current annualized yield, basis points (e.g. 512 = 5.12% APY). */
  apyBps: number;
  asOf: Date;
}

/** Current published yield rate. Callers: lib/savings/yieldRate.ts's cache ONLY — see file header. */
export async function getUsycYieldRate(): Promise<UsycYieldRate> {
  const env = getEnv();

  const res = await fetch(`${CIRCLE_USYC_API_BASE}/yield-rate`, {
    headers: { authorization: `Bearer ${env.CIRCLE_API_KEY}` },
  });

  if (!res.ok) {
    throw new CircleUsycApiError(`Circle USYC API returned ${res.status} fetching yield rate`);
  }

  const json = (await res.json()) as { data?: { apy?: string; asOf?: string } };
  if (json.data?.apy === undefined) {
    throw new CircleUsycApiError("Circle USYC API returned no yield-rate data");
  }

  // `apy` comes back as a decimal string percentage, e.g. "5.12" -> 512 bps.
  const apyBps = Math.round(parseFloat(json.data.apy) * 100);

  return { apyBps, asOf: json.data.asOf ? new Date(json.data.asOf) : new Date() };
}