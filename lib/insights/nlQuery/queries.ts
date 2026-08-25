// lib/insights/nlQuery/queries.ts
//
// One function per supported intent. Every query is scoped to the org
// via `wallet: { orgId }` (OnchainTransaction has no direct orgId column
// — see schema.prisma), and every money figure returned here is a
// string produced by toDecimalString, never a raw BigInt or a
// float-rounded approximation, matching the convention already used in
// lib/insights/anomalies/service.ts.
//
// Only CONFIRMED transactions are counted by default — PENDING/FAILED
// rows shouldn't move a "how much did I spend" answer. If a use case
// needs pending activity included, add a `includePending` flag rather
// than silently changing this default.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
// Import path matches lib/insights/anomalies/service.ts's existing
// `@/app/generated/prisma/client` import. schema.prisma uses the
// "prisma-client" generator (not the classic "prisma-client-js"), so if
// `Prisma.OnchainTransactionWhereInput` isn't exported the same way
// under that generator in your generated version, swap this for
// whatever the anomalies module's equivalent where-input type import
// looks like.
import type { OnchainDirection, Prisma } from "@/app/generated/prisma/client";
import type { ResolvedInterval, QueryDirection } from "./types";

function dirFilter(direction: QueryDirection): { direction: OnchainDirection } | object {
  return direction === "BOTH" ? {} : { direction: direction as OnchainDirection };
}

// toDecimalString throws on negative input — it's built for Circle's
// API, which only ever deals in unsigned amounts (see
// lib/circle/amount.ts). "net" (received - sent) is the one figure in
// this module that can legitimately go negative (spent more than
// received), so it needs its own sign-aware formatting rather than
// going through toDecimalString directly with a possibly-negative
// bigint. This is the same failure mode as the existing
// dashboard/queries.ts#getInflowOutflowTrend crash — toDecimalString
// still only ever sees a non-negative bigint, the sign is handled here.
function toSignedDecimalString(amount: bigint): string {
  return amount < 0n ? `-${toDecimalString(-amount)}` : toDecimalString(amount);
}

function baseWhere(orgId: string, interval: ResolvedInterval, direction: QueryDirection): Prisma.OnchainTransactionWhereInput {
  return {
    wallet: { orgId },
    status: "CONFIRMED",
    createdAt: { gte: interval.from, lte: interval.to },
    ...dirFilter(direction),
  };
}

// ── spend_by_category ───────────────────────────────────────────────

export interface CategoryBreakdownRow {
  categoryId: string;
  categoryName: string;
  totalAmount: string;
  transactionCount: number;
}

export async function getSpendByCategory(
  orgId: string,
  interval: ResolvedInterval,
  direction: Exclude<QueryDirection, "BOTH">,
  limit = 5
): Promise<CategoryBreakdownRow[]> {
  // Category totals require joining through TransactionCategorization,
  // which Prisma's groupBy can't do across a relation in one query — so
  // fetch matching, categorized transactions and reduce in JS. BigInt
  // addition here is exact; fine for typical org transaction volumes.
  // For very high-volume orgs, replace with a raw SQL GROUP BY.
  const rows = await prisma.onchainTransaction.findMany({
    where: { ...baseWhere(orgId, interval, direction), categorization: { isNot: null } },
    select: {
      amount: true,
      categorization: { select: { categoryId: true, category: { select: { name: true } } } },
    },
  });

  const totals = new Map<string, { name: string; sum: bigint; count: number }>();
  for (const row of rows) {
    const cat = row.categorization;
    if (!cat) continue;
    const existing = totals.get(cat.categoryId) ?? { name: cat.category.name, sum: 0n, count: 0 };
    existing.sum += row.amount;
    existing.count += 1;
    totals.set(cat.categoryId, existing);
  }

  return [...totals.entries()]
    .sort(([, a], [, b]) => (a.sum > b.sum ? -1 : a.sum < b.sum ? 1 : 0))
    .slice(0, limit)
    .map(([categoryId, v]) => ({
      categoryId,
      categoryName: v.name,
      totalAmount: toDecimalString(v.sum),
      transactionCount: v.count,
    }));
}

// ── top_counterparties ──────────────────────────────────────────────

export interface CounterpartyRow {
  counterpartyAddress: string;
  totalAmount: string;
  transactionCount: number;
}

export async function getTopCounterparties(
  orgId: string,
  interval: ResolvedInterval,
  direction: Exclude<QueryDirection, "BOTH">,
  limit = 5,
  categoryId?: string
): Promise<CounterpartyRow[]> {
  const grouped = await prisma.onchainTransaction.groupBy({
    by: ["counterpartyAddress"],
    where: {
      ...baseWhere(orgId, interval, direction),
      ...(categoryId ? { categorization: { categoryId } } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
    orderBy: { _sum: { amount: "desc" } },
    take: limit,
  });

  return grouped.map((g) => ({
    counterpartyAddress: g.counterpartyAddress,
    totalAmount: toDecimalString(g._sum.amount ?? 0n),
    transactionCount: g._count._all,
  }));
}

// ── biggest_transaction ─────────────────────────────────────────────

export interface SingleTransactionRow {
  id: string;
  amount: string;
  counterpartyAddress: string;
  createdAt: Date;
  memo: string | null;
  categoryName: string | null;
}

export async function getBiggestTransaction(
  orgId: string,
  interval: ResolvedInterval,
  direction: Exclude<QueryDirection, "BOTH">,
  opts: { categoryId?: string; counterpartyAddress?: string } = {}
): Promise<SingleTransactionRow | null> {
  const tx = await prisma.onchainTransaction.findFirst({
    where: {
      ...baseWhere(orgId, interval, direction),
      ...(opts.categoryId ? { categorization: { categoryId: opts.categoryId } } : {}),
      ...(opts.counterpartyAddress ? { counterpartyAddress: opts.counterpartyAddress } : {}),
    },
    orderBy: { amount: "desc" },
    include: { categorization: { include: { category: true } } },
  });
  if (!tx) return null;
  return {
    id: tx.id,
    amount: toDecimalString(tx.amount),
    counterpartyAddress: tx.counterpartyAddress,
    createdAt: tx.createdAt,
    memo: tx.memo,
    categoryName: tx.categorization?.category.name ?? null,
  };
}

// ── totals ───────────────────────────────────────────────────────────

export interface TotalsResult {
  totalIn: string;
  totalOut: string;
  net: string;
  transactionCount: number;
}

export async function getTotals(
  orgId: string,
  interval: ResolvedInterval,
  opts: { categoryId?: string; counterpartyAddress?: string } = {}
): Promise<TotalsResult> {
  const where = (direction: OnchainDirection): Prisma.OnchainTransactionWhereInput => ({
    wallet: { orgId },
    status: "CONFIRMED",
    createdAt: { gte: interval.from, lte: interval.to },
    direction,
    ...(opts.categoryId ? { categorization: { categoryId: opts.categoryId } } : {}),
    ...(opts.counterpartyAddress ? { counterpartyAddress: opts.counterpartyAddress } : {}),
  });

  const [inAgg, outAgg] = await Promise.all([
    prisma.onchainTransaction.aggregate({ where: where("IN"), _sum: { amount: true }, _count: true }),
    prisma.onchainTransaction.aggregate({ where: where("OUT"), _sum: { amount: true }, _count: true }),
  ]);

  const totalIn = inAgg._sum.amount ?? 0n;
  const totalOut = outAgg._sum.amount ?? 0n;

  return {
    totalIn: toDecimalString(totalIn),
    totalOut: toDecimalString(totalOut),
    net: toSignedDecimalString(totalIn - totalOut),
    transactionCount: inAgg._count + outAgg._count,
  };
}

// ── transaction_count ───────────────────────────────────────────────

export async function getTransactionCount(
  orgId: string,
  interval: ResolvedInterval,
  direction: QueryDirection,
  opts: { categoryId?: string; counterpartyAddress?: string } = {}
): Promise<number> {
  return prisma.onchainTransaction.count({
    where: {
      ...baseWhere(orgId, interval, direction),
      ...(opts.categoryId ? { categorization: { categoryId: opts.categoryId } } : {}),
      ...(opts.counterpartyAddress ? { counterpartyAddress: opts.counterpartyAddress } : {}),
    },
  });
}

// ── average_transaction ─────────────────────────────────────────────

export async function getAverageTransaction(
  orgId: string,
  interval: ResolvedInterval,
  direction: Exclude<QueryDirection, "BOTH">,
  categoryId?: string
): Promise<{ average: string; transactionCount: number } | null> {
  const agg = await prisma.onchainTransaction.aggregate({
    where: {
      ...baseWhere(orgId, interval, direction),
      ...(categoryId ? { categorization: { categoryId } } : {}),
    },
    _sum: { amount: true },
    _count: true,
  });
  if (agg._count === 0) return null;
  const sum = agg._sum.amount ?? 0n;
  // Average of a currency amount displayed to 2dp — Number precision is
  // more than sufficient here (USDC amounts, 6 decimals, realistic
  // treasury volumes are nowhere near Number.MAX_SAFE_INTEGER).
  const average = Number(toDecimalString(sum)) / agg._count;
  return { average: average.toFixed(2), transactionCount: agg._count };
}

// ── counterparty_history ────────────────────────────────────────────

export interface CounterpartyHistory {
  totals: TotalsResult;
  recentTransactions: SingleTransactionRow[];
}

export async function getCounterpartyHistory(
  orgId: string,
  interval: ResolvedInterval,
  counterpartyAddress: string
): Promise<CounterpartyHistory> {
  const [totals, recent] = await Promise.all([
    getTotals(orgId, interval, { counterpartyAddress }),
    prisma.onchainTransaction.findMany({
      where: { wallet: { orgId }, status: "CONFIRMED", counterpartyAddress, createdAt: { gte: interval.from, lte: interval.to } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { categorization: { include: { category: true } } },
    }),
  ]);

  return {
    totals,
    recentTransactions: recent.map((tx) => ({
      id: tx.id,
      amount: toDecimalString(tx.amount),
      counterpartyAddress: tx.counterpartyAddress,
      createdAt: tx.createdAt,
      memo: tx.memo,
      categoryName: tx.categorization?.category.name ?? null,
    })),
  };
}

// ── list_categories ─────────────────────────────────────────────────

export async function getActiveCategoryNames(orgId: string): Promise<string[]> {
  const cats = await prisma.transactionCategory.findMany({
    where: { orgId, archived: false },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return cats.map((c) => c.name);
}

// ── trend ────────────────────────────────────────────────────────────

export interface TrendBucket {
  bucketStart: Date;
  label: string;
  totalIn: string;
  totalOut: string;
  net: string;
}

function bucketKey(date: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  // week: key by the Monday of that week, in UTC-normalized YYYY-MM-DD form
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function bucketLabel(key: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: "numeric", month: "short" });
  }
  const d = new Date(key);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return granularity === "week" ? `Week of ${d.toLocaleDateString(undefined, opts)}` : d.toLocaleDateString(undefined, opts);
}

/**
 * Buckets confirmed transaction totals by day/week/month. Reduced in JS
 * (same tradeoff as getSpendByCategory) rather than a DB-level date_trunc
 * — fine at typical org transaction volumes; move to raw SQL if a given
 * org's interval regularly spans thousands of rows.
 */
export async function getTrend(
  orgId: string,
  interval: ResolvedInterval,
  granularity: "day" | "week" | "month"
): Promise<TrendBucket[]> {
  const rows = await prisma.onchainTransaction.findMany({
    where: { wallet: { orgId }, status: "CONFIRMED", createdAt: { gte: interval.from, lte: interval.to } },
    select: { amount: true, direction: true, createdAt: true },
  });

  const buckets = new Map<string, { in: bigint; out: bigint }>();
  for (const row of rows) {
    const key = bucketKey(row.createdAt, granularity);
    const existing = buckets.get(key) ?? { in: 0n, out: 0n };
    if (row.direction === "IN") existing.in += row.amount;
    else existing.out += row.amount;
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => ({
      bucketStart: new Date(key),
      label: bucketLabel(key, granularity),
      totalIn: toDecimalString(v.in),
      totalOut: toDecimalString(v.out),
      net: toSignedDecimalString(v.in - v.out),
    }));
}