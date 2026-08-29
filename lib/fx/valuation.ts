// lib/fx/valuation.ts
//
// Fiat valuation helpers for dashboard display.
//
// Valuation chain (conceptual):
//   USDC balance  ≈  USD balance  →  × FX rate  →  local fiat
//
// Precision strategy: the whole codebase stores USDC as bigint in
// "micro-USDC" (6 decimal places — see lib/circle/amount.ts). FX rates
// from the DB come back as Prisma Decimal, which we stringify and treat
// as a 12-decimal-place integer for multiplication. Every intermediate
// operation uses bigint. The final display value is rounded to the
// currency's conventional decimal places (2 for most fiat, 0 for JPY,
// etc.) according to CURRENCY_DECIMALS below.
//
// Nothing here should ever touch Number / parseFloat.

import { prisma } from "@/lib/db/prisma";
import type { FxRate, Currency, Country } from "@/app/generated/prisma/client";

export type RateStatus = "fresh" | "stale" | "unavailable";

export const DEFAULT_FX_RATE_MAX_AGE_HOURS = 2;

const MS_PER_HOUR = 60 * 60 * 1000;

// ISO 4217 currencies that use non-2 decimal display.
// Anything not listed defaults to 2. 0 means no decimals (JPY, KRW, …).
const CURRENCY_DECIMALS_OVERRIDE: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  VND: 0,
  GNF: 0,
  KMF: 0,
  MGA: 1,
  MRU: 1,
  RWF: 0,
  UGX: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BIF: 0,
  DJF: 0,
  KHR: 2,
  LAK: 2,
  MMK: 2,
  PYG: 0,
};

export function getCurrencyDecimalPlaces(code: string): number {
  return CURRENCY_DECIMALS_OVERRIDE[code] ?? 2;
}

export function getMaxAgeMs(): number {
  const raw = process.env.FX_RATE_MAX_AGE_HOURS;
  const hours = raw ? Number(raw) : DEFAULT_FX_RATE_MAX_AGE_HOURS;
  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_FX_RATE_MAX_AGE_HOURS * MS_PER_HOUR;
  }
  return hours * MS_PER_HOUR;
}

export function getRateStatus(
  now: Date,
  fetchedAt: Date | null | undefined
): RateStatus {
  if (!fetchedAt) return "unavailable";
  const age = now.getTime() - fetchedAt.getTime();
  return age <= getMaxAgeMs() ? "fresh" : "stale";
}

// ------------ helpers for bigint-based decimal math -----------------------

// Scale used when converting a Prisma.Decimal(24,12) rate string to a
// bigint multiplier. Matches the DB column's 12 fractional digits.
const RATE_SCALE = 12n;
const RATE_SCALE_DIVISOR = 10n ** RATE_SCALE; // 1e12

// Parses a DB rate (e.g. "1340.25" or "0.85" or the Prisma Decimal
// object's .toString()) into a bigint scaled by 1e12.
//
//   "1340.25"  →  1340_250000000000n
//   "0.85"     →  0000_850000000000n
//
// Returns null on invalid input (non-numeric characters, etc.).
export function parseRateToScaledBigint(rateStr: string): bigint | null {
  if (!rateStr) return null;
  const trimmed = rateStr.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = frac.padEnd(Number(RATE_SCALE), "0").slice(0, Number(RATE_SCALE));
  try {
    return BigInt(whole) * RATE_SCALE_DIVISOR + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

// ------------ core valuation ---------------------------------------------

export interface FiatValuationResult {
  currency: string; // e.g. "NGN"
  supported: boolean;
  amount: string | null; // decimal string formatted to currency's decimals
  rate: string | null; // raw rate as decimal string (from DB, 12dp max)
  rateUpdatedAt: string | null; // ISO date
  rateStatus: RateStatus;
  symbol: string | null;
  currencyName: string | null;
}

/**
 * Looks up the org's preferred currency, verifies it has a valid
 * (non-null, non-zero, not-too-stale) FxRate, and returns the valuation
 * of `usdcMicroAmount` (micro-USDC, 6 decimals) in that currency.
 *
 * Never throws — if anything is unsupported the returned object has
 * `supported: false` and the caller can just show USDC only.
 */
export async function valueUsdcInPreferredCurrency(params: {
  orgId: string;
  usdcMicroAmount: bigint;
  now?: Date;
}): Promise<FiatValuationResult> {
  const { orgId, usdcMicroAmount } = params;
  const now = params.now ?? new Date();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { preferredCurrencyCode: true },
  });
  const preferredCode = org?.preferredCurrencyCode;

  if (!preferredCode) {
    return unavailable(null);
  }

  const [currency, fxRate] = await Promise.all([
    prisma.currency.findUnique({
      where: { code: preferredCode },
      select: { code: true, name: true, symbol: true, isSupported: true },
    }),
    prisma.fxRate.findUnique({
      where: {
        baseCurrency_quoteCurrency: {
          baseCurrency: "USD",
          quoteCurrency: preferredCode,
        },
      },
      select: { rate: true, fetchedAt: true, sourceTimestamp: true },
    }),
  ]);

  if (!currency || !currency.isSupported) {
    return unavailable(preferredCode);
  }

  const rateStr = fxRate?.rate?.toString() ?? null;
  const scaledRate = rateStr ? parseRateToScaledBigint(rateStr) : null;

  if (!fxRate || !scaledRate || scaledRate <= 0n) {
    return {
      currency: preferredCode,
      supported: false,
      amount: null,
      rate: rateStr ?? null,
      rateUpdatedAt: fxRate?.fetchedAt?.toISOString() ?? null,
      rateStatus: "unavailable",
      symbol: currency.symbol,
      currencyName: currency.name,
    };
  }

  const status = getRateStatus(now, fxRate.fetchedAt);
  if (status === "unavailable") {
    return {
      currency: preferredCode,
      supported: false,
      amount: null,
      rate: rateStr,
      rateUpdatedAt: fxRate.fetchedAt.toISOString(),
      rateStatus: "unavailable",
      symbol: currency.symbol,
      currencyName: currency.name,
    };
  }

  const displayAmount = computeFiatDisplayAmount(
    usdcMicroAmount,
    scaledRate,
    getCurrencyDecimalPlaces(preferredCode)
  );

  return {
    currency: preferredCode,
    supported: true,
    amount: displayAmount,
    rate: rateStr,
    rateUpdatedAt: fxRate.fetchedAt.toISOString(),
    rateStatus: status,
    symbol: currency.symbol,
    currencyName: currency.name,
  };

  function unavailable(code: string | null): FiatValuationResult {
    return {
      currency: code ?? "USD",
      supported: false,
      amount: null,
      rate: null,
      rateUpdatedAt: null,
      rateStatus: "unavailable",
      symbol: null,
      currencyName: null,
    };
  }
}

/**
 * Pure bigint math: usdc (6dp) × rate (12dp) → formatted decimal string
 * rounded to `targetDecimals` places.
 *
 *   usdcMicro=1_000_000_000n (=1,000.000000 USDC)
 *   scaledRate=1340_250000000000n (=1340.25)
 *   → 1000 × 1340.25 = 1,340,250.00
 */
export function computeFiatDisplayAmount(
  usdcMicro: bigint,
  scaledRate: bigint,
  targetDecimals: number
): string {
  const USDC_DECIMALS = 6n;
  const USDC_SCALE = 10n ** USDC_DECIMALS;

  const total = usdcMicro * scaledRate; // 6 + 12 = 18 fractional dp
  const wholePart = total / (USDC_SCALE * RATE_SCALE_DIVISOR);
  const remainder = total % (USDC_SCALE * RATE_SCALE_DIVISOR);

  const targetScale = 10n ** BigInt(Math.max(0, targetDecimals));
  const fracScaled = (remainder * targetScale) / (USDC_SCALE * RATE_SCALE_DIVISOR);
  const roundingNano =
    ((remainder * targetScale) % (USDC_SCALE * RATE_SCALE_DIVISOR)) * 2n;
  const roundUp = roundingNano >= USDC_SCALE * RATE_SCALE_DIVISOR ? 1n : 0n;

  let fracFinal = fracScaled + roundUp;
  let carry = 0n;
  if (fracFinal >= targetScale) {
    carry = fracFinal / targetScale;
    fracFinal = fracFinal % targetScale;
  }
  const finalWhole = wholePart + carry;

  const wholeStr = finalWhole.toString();
  if (targetDecimals <= 0) return wholeStr;

  const fracStr = fracFinal.toString().padStart(targetDecimals, "0");
  return `${wholeStr}.${fracStr}`;
}

// ------------ public read helpers ----------------------------------------

export async function listSupportedCountries(now = new Date()): Promise<
  Array<{
    code: string;
    name: string;
    currencyCode: string;
    currencyName: string;
    currencySymbol: string;
    flag: string;
    supported: boolean;
  }>
> {
  const [countries, validRates] = await Promise.all([
    prisma.country.findMany({
      orderBy: { name: "asc" },
      select: {
        code: true,
        name: true,
        currencyCode: true,
        currencyName: true,
        currencySymbol: true,
        flag: true,
      },
    }),
    prisma.fxRate.findMany({
      where: {
        baseCurrency: "USD",
        fetchedAt: { gte: new Date(now.getTime() - getMaxAgeMs()) },
      },
      select: { quoteCurrency: true },
    }),
  ]);

  const freshQuotes = new Set(validRates.map((r) => r.quoteCurrency));

  return countries.map((c) => ({
    code: c.code,
    name: c.name,
    currencyCode: c.currencyCode,
    currencyName: c.currencyName,
    currencySymbol: c.currencySymbol,
    flag: c.flag,
    supported: freshQuotes.has(c.currencyCode),
  }));
}

export interface RatesResponse {
  base: string;
  updatedAt: string | null;
  rates: Record<
    string,
    {
      rate: string;
      symbol: string;
      name: string;
      status: RateStatus;
    }
  >;
}

export async function getRatesResponse(now = new Date()): Promise<RatesResponse> {
  const [currencies, rates] = await Promise.all([
    prisma.currency.findMany({
      where: { isSupported: true },
      select: { code: true, name: true, symbol: true },
    }),
    prisma.fxRate.findMany({
      where: { baseCurrency: "USD" },
      select: { quoteCurrency: true, rate: true, fetchedAt: true },
    }),
  ]);

  const byQuote = new Map(rates.map((r) => [r.quoteCurrency, r]));
  const curMap = new Map(currencies.map((c) => [c.code, c]));

  let latestAt: Date | null = null;
  const ratesOut: RatesResponse["rates"] = {};

  for (const cur of currencies) {
    const row = byQuote.get(cur.code);
    if (!row) continue;
    const status = getRateStatus(now, row.fetchedAt);
    if (!latestAt || row.fetchedAt > latestAt) latestAt = row.fetchedAt;
    ratesOut[cur.code] = {
      rate: row.rate.toString(),
      symbol: cur.symbol,
      name: cur.name,
      status,
    };
  }

  return {
    base: "USD",
    updatedAt: latestAt ? latestAt.toISOString() : null,
    rates: ratesOut,
  };
}
