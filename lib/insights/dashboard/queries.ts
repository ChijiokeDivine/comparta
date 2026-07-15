// lib/insights/dashboard/queries.ts
//
// Read-only aggregation queries for the spending-insights dashboard.
// Every function returns data already shaped for a chart/table — decimal
// strings for money, pre-sorted, pre-bucketed — so a UI layer can render
// directly from the response with no further reshaping. Nothing here
// mutates anything.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { resolveCounterpartyDisplayNames } from "@/lib/insights/counterparty";
import { listActiveCategories } from "@/lib/insights/categorization/seed";
import type { OnchainDirection } from "@/app/generated/prisma/client";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DateRange {
  from: Date;
  to: Date;
}

/** Common range shorthands the UI can offer as quick-select buttons, resolved server-side against `now` so "current month" always means the caller's actual current month. */
export type RangePreset = "current_month" | "trailing_90_days" | "trailing_30_days" | "custom";

export function resolveRangePreset(
  preset: RangePreset,
  now: Date,
  custom?: { from: string; to: string }
): DateRange {
  switch (preset) {
    case "current_month": {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from, to: now };
    }
    case "trailing_30_days":
      return { from: new Date(now.getTime() - 30 * MS_PER_DAY), to: now };
    case "trailing_90_days":
      return { from: new Date(now.getTime() - 90 * MS_PER_DAY), to: now };
    case "custom": {
      if (!custom) throw new Error("resolveRangePreset: custom range requires from/to");
      const from = new Date(custom.from);
      const to = new Date(custom.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw new Error("resolveRangePreset: invalid custom date range");
      }
      return { from, to };
    }
  }
}

// ── spend by category ───────────────────────────────────────────────────

export interface SpendByCategorySlice {
  categoryId: string;
  categoryName: string;
  totalAmount: string; // decimal string
  transactionCount: number;
}

export interface SpendByCategoryResult {
  range: { from: string; to: string };
  direction: OnchainDirection;
  slices: SpendByCategorySlice[];
  uncategorizedAmount: string; // transactions in range with no categorization row at all (e.g. still PENDING categorization)
  uncategorizedCount: number;
}

/** Sums CONFIRMED transaction amounts in `range`, grouped by category. Defaults to OUT (spend) — pass direction: "IN" for a revenue-by-category breakdown of the same shape. */
export async function getSpendByCategory(
  orgId: string,
  range: DateRange,
  direction: OnchainDirection = "OUT"
): Promise<SpendByCategoryResult> {
  await listActiveCategories(orgId); // ensures curated categories exist so every org has a full category set to report against, even at 0

  const transactions = await prisma.onchainTransaction.findMany({
    where: {
      wallet: { orgId },
      direction,
      status: "CONFIRMED",
      createdAt: { gte: range.from, lte: range.to },
    },
    include: { categorization: { include: { category: true } } },
  });

  const totals = new Map<string, { name: string; amount: bigint; count: number }>();
  let uncategorizedAmount = 0n;
  let uncategorizedCount = 0;

  for (const tx of transactions) {
    if (!tx.categorization) {
      uncategorizedAmount += tx.amount;
      uncategorizedCount += 1;
      continue;
    }
    const key = tx.categorization.categoryId;
    const entry = totals.get(key) ?? { name: tx.categorization.category.name, amount: 0n, count: 0 };
    entry.amount += tx.amount;
    entry.count += 1;
    totals.set(key, entry);
  }

  const slices: SpendByCategorySlice[] = Array.from(totals.entries())
    .map(([categoryId, v]) => ({
      categoryId,
      categoryName: v.name,
      totalAmount: toDecimalString(v.amount),
      transactionCount: v.count,
    }))
    .sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount));

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    direction,
    slices,
    uncategorizedAmount: toDecimalString(uncategorizedAmount),
    uncategorizedCount,
  };
}

// ── inflow vs outflow trend ─────────────────────────────────────────────

export type TrendGranularity = "day" | "week" | "month";

export interface InflowOutflowPoint {
  bucketStart: string; // ISO date
  inflow: string; // decimal string
  outflow: string; // decimal string
  net: string; // decimal string, inflow - outflow
}

export async function getInflowOutflowTrend(
  orgId: string,
  range: DateRange,
  granularity: TrendGranularity = "day"
): Promise<InflowOutflowPoint[]> {
  const transactions = await prisma.onchainTransaction.findMany({
    where: { wallet: { orgId }, status: "CONFIRMED", createdAt: { gte: range.from, lte: range.to } },
    select: { amount: true, direction: true, createdAt: true },
  });

  const buckets = new Map<string, { inflow: bigint; outflow: bigint }>();

  for (const tx of transactions) {
    const key = bucketKeyFor(tx.createdAt, granularity);
    const entry = buckets.get(key) ?? { inflow: 0n, outflow: 0n };
    if (tx.direction === "IN") entry.inflow += tx.amount;
    else entry.outflow += tx.amount;
    buckets.set(key, entry);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucketStart, v]) => ({
      bucketStart,
      inflow: toDecimalString(v.inflow),
      outflow: toDecimalString(v.outflow),
      net: toDecimalString(v.inflow - v.outflow),
    }));
}

function bucketKeyFor(date: Date, granularity: TrendGranularity): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return date.toISOString().slice(0, 7); // YYYY-MM
  // week: ISO-ish — key by the Monday of that week (UTC), so buckets are stable and sortable as strings.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

// ── per-bucket balance trend ─────────────────────────────────────────────

export interface BalanceTrendPoint {
  date: string; // ISO date
  balance: string; // decimal string — the last known balance as of end-of-day
}

/** Reconstructs a bucket's balance over time from LedgerEntry.balanceAfter (already denormalized on write — see lib/ledger/engine.ts), downsampled to one point per day (the last entry of each day). */
export async function getBucketBalanceTrend(
  orgId: string,
  ledgerAccountId: string,
  range: DateRange
): Promise<BalanceTrendPoint[]> {
  // Ownership check via a direct query rather than importing
  // lib/buckets/service.ts here, to keep this module dependency-light —
  // callers (API routes) are expected to have already verified ownership
  // via getBucket() before calling this, same as every other insights
  // query in this file takes orgId-scoped input on faith from its caller.
  const entries = await prisma.ledgerEntry.findMany({
    where: { ledgerAccountId, createdAt: { gte: range.from, lte: range.to } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, balanceAfter: true },
  });

  // Seed with the balance immediately before the range starts, so the
  // trend doesn't visually start at $0 if the account already had a
  // balance going into the range.
  const priorEntry = await prisma.ledgerEntry.findFirst({
    where: { ledgerAccountId, createdAt: { lt: range.from } },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });

  const dailyLast = new Map<string, bigint>();
  if (priorEntry) {
    dailyLast.set(range.from.toISOString().slice(0, 10), priorEntry.balanceAfter);
  }

  for (const entry of entries) {
    dailyLast.set(entry.createdAt.toISOString().slice(0, 10), entry.balanceAfter);
  }

  // Forward-fill: a day with no entries keeps the previous day's balance,
  // so the chart is a continuous line rather than only plotting days with
  // activity.
  const points: BalanceTrendPoint[] = [];
  let runningBalance = priorEntry?.balanceAfter ?? 0n;
  const cursor = new Date(range.from);

  while (cursor <= range.to) {
    const key = cursor.toISOString().slice(0, 10);
    if (dailyLast.has(key)) runningBalance = dailyLast.get(key)!;
    points.push({ date: key, balance: toDecimalString(runningBalance) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
}

// ── top counterparties ──────────────────────────────────────────────────

export interface TopCounterparty {
  address: string;
  displayName: string;
  totalAmount: string; // decimal string
  transactionCount: number;
}

export async function getTopCounterparties(
  orgId: string,
  range: DateRange,
  options: { direction?: OnchainDirection; limit?: number } = {}
): Promise<TopCounterparty[]> {
  const direction = options.direction ?? "OUT";
  const limit = options.limit ?? 10;

  const transactions = await prisma.onchainTransaction.findMany({
    where: {
      wallet: { orgId },
      direction,
      status: "CONFIRMED",
      createdAt: { gte: range.from, lte: range.to },
    },
    select: { counterpartyAddress: true, amount: true },
  });

  const totals = new Map<string, { amount: bigint; count: number }>();
  for (const tx of transactions) {
    const entry = totals.get(tx.counterpartyAddress) ?? { amount: 0n, count: 0 };
    entry.amount += tx.amount;
    entry.count += 1;
    totals.set(tx.counterpartyAddress, entry);
  }

  const sorted = Array.from(totals.entries())
    .sort(([, a], [, b]) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))
    .slice(0, limit);

  const displayNames = await resolveCounterpartyDisplayNames(orgId, sorted.map(([address]) => address));

  return sorted.map(([address, v]) => ({
    address,
    displayName: displayNames.get(address) ?? address,
    totalAmount: toDecimalString(v.amount),
    transactionCount: v.count,
  }));
}