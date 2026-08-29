// app/api/internal/fx/sync/route.ts
//
// Hourly cron endpoint: fetches the full USD-based rate sheet from Open
// Exchange Rates and upserts FxRate rows for every quote currency that
// has a valid (finite, positive) rate.  Protected by CRON_SECRET — not
// callable from the public web.
//
// Contract (spec §6–§7, §16):
//   • One HTTP call per sync — never one-per-currency.
//   • Invalid provider values (null, 0, negative, NaN) do NOT overwrite
//     the last known good rate for that code.
//   • Provider failures never delete rows or blank out rates — keep
//     the last known good data and let rate freshness (fetchedAt) mark
//     it stale once it crosses FX_RATE_MAX_AGE_HOURS.
//   • Acquire an in-process lock so overlapping cron invocations can't
//     hammer the provider or write races.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

// ---------- authentication -------------------------------------------------

function verifyCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[fx/sync] CRON_SECRET not configured — rejecting all calls");
    return false;
  }
  const url = new URL(req.url);
  const token =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret");
  if (!token) return false;
  // constant-time-ish compare
  let diff = expected.length ^ token.length;
  const len = Math.min(expected.length, token.length);
  for (let i = 0; i < len; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

// ---------- concurrency lock -----------------------------------------------

let syncLock: Promise<void> | null = null;

async function acquireLock(): Promise<() => void> {
  // If another sync is running, return a reject — cron caller should not
  // queue up; it should just report "skipped (already running)" and exit.
  if (syncLock) {
    throw new LockHeldError();
  }
  let release: () => void = () => {};
  syncLock = new Promise<void>((res) => {
    release = res;
  });
  return release;
}

class LockHeldError extends Error {
  constructor() {
    super("FX sync already in progress");
    this.name = "LockHeldError";
  }
}

// ---------- provider schema ------------------------------------------------

const OerResponseSchema = z.object({
  base: z.literal("USD"),
  timestamp: z.number().int().positive(),
  rates: z.record(z.string(), z.union([z.number(), z.null()])),
});

type OerRates = Record<string, number | null>;

// ---------- currency allow-list --------------------------------------------
//
// We never upsert a rate for a code that isn't in our own Currency
// catalog. The provider ships things like BTC, XAU, XDR, obsolete codes
// etc. that are not appropriate for a "local fiat" selector (spec §15).

const PROVIDER_TIMEOUT_MS = 30_000;

// ---------- handler --------------------------------------------------------

async function handleSync(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let release: (() => void) | null = null;
  try {
    release = await acquireLock();
  } catch (err) {
    if (err instanceof LockHeldError) {
      return NextResponse.json(
        { success: false, error: "Sync already running", skipped: 0, updated: 0 },
        { status: 409 }
      );
    }
    throw err;
  }

  try {
    const result = await runSync();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[fx/sync] sync failed", err);
    return NextResponse.json(
      { success: false, error: message, updated: 0, skipped: 0 },
      { status: 502 }
    );
  } finally {
    if (release) release();
    syncLock = null;
  }
}

export const GET = handleSync;
export const POST = handleSync;

// ---------- actual sync logic ----------------------------------------------

async function runSync(): Promise<{
  updated: number;
  skipped: number;
  timestamp: number;
  base: string;
}> {
  const appId = process.env.OPEN_EXCHANGE_RATE_APP_ID;
  if (!appId) {
    throw new Error("OPEN_EXCHANGE_RATE_APP_ID not configured");
  }

  // 1. fetch — one request, all currencies (spec §2)
  const url = `https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(appId)}`;
  let raw: unknown;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 0 },
    });
    clearTimeout(t);
    if (!res.ok) {
      throw new Error(`Open Exchange Rates HTTP ${res.status}: ${res.statusText}`);
    }
    raw = await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Open Exchange Rates timed out after ${PROVIDER_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  // 2. validate — spec §6.4–§6.6
  const parsed = OerResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid provider response: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}=${i.message}`)
        .join("; ")}`
    );
  }
  const { base, timestamp, rates } = parsed.data;

  // 3. load our catalog once
  const catalogRows = await prisma.currency.findMany({
    where: { isSupported: true },
    select: { code: true },
  });
  const allowedCodes = new Set(catalogRows.map((c) => c.code));

  // 4. iterate rates, upsert only valid ones (spec §7 — skip null/0/neg)
  const sourceTs = new Date(timestamp * 1000);
  const fetchedAt = new Date();

  let updated = 0;
  let skipped = 0;

  for (const [code, rawRate] of Object.entries(rates as OerRates)) {
    if (!allowedCodes.has(code)) {
      skipped++;
      continue;
    }
    if (
      rawRate === null ||
      typeof rawRate !== "number" ||
      !Number.isFinite(rawRate) ||
      rawRate <= 0
    ) {
      // spec §7 — do NOT overwrite; leave last known good in place
      skipped++;
      continue;
    }

    try {
      await prisma.fxRate.upsert({
        where: {
          baseCurrency_quoteCurrency: {
            baseCurrency: base,
            quoteCurrency: code,
          },
        },
        create: {
          baseCurrency: base,
          quoteCurrency: code,
          rate: new Prisma.Decimal(rawRate),
          source: "open_exchange_rates",
          sourceTimestamp: sourceTs,
          fetchedAt,
        },
        update: {
          rate: new Prisma.Decimal(rawRate),
          sourceTimestamp: sourceTs,
          fetchedAt,
        },
      });
      updated++;
    } catch (err) {
      console.warn(`[fx/sync] failed to upsert ${base}/${code}`, err);
      skipped++;
    }
  }

  return { updated, skipped, timestamp, base };
}
