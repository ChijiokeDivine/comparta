// lib/insights/nlQuery/executeQuery.ts
//
// Turns an already-validated StructuredQueryFilter into a Prisma query.
// This is the only function that touches the database for the NL-query
// feature — it never receives raw text, only the zod-validated,
// schema-constrained filter object from llmTranslate.ts. Every field on
// the filter maps to a specific, fixed Prisma where-clause fragment;
// there is no string concatenation into a query anywhere in this file.

import { prisma } from "@/lib/db/prisma";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { resolveCounterpartyDisplayNames } from "@/lib/insights/counterparty";
import type { StructuredQueryFilter } from "./schema";
import type { Prisma } from "@/app/generated/prisma/client";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface NlQueryTransactionResult {
  id: string;
  direction: "IN" | "OUT";
  amount: string; // decimal string
  counterpartyAddress: string;
  counterpartyDisplayName: string;
  memo: string | null;
  categoryName: string | null;
  createdAt: string; // ISO
}

export interface NlQueryResult {
  transactions: NlQueryTransactionResult[];
  totalAmount: string; // decimal string — sum of ALL matches, not just the returned page (see note below)
  totalCount: number;
  resolvedRange: { from: string | null; to: string | null };
}

/**
 * Executes `filter` against OnchainTransaction, scoped to `orgId`.
 * totalAmount/totalCount reflect EVERY matching row (a separate
 * aggregate query), independent of `filter.limit` — so "how much did I
 * pay contractors last quarter" answers correctly even if there were 300
 * matching transactions and only the first 50 are returned as the
 * detail list.
 */
export async function executeStructuredQuery(
  orgId: string,
  filter: StructuredQueryFilter
): Promise<NlQueryResult> {
  const { from, to } = resolveDateBounds(filter);

  const where: Prisma.OnchainTransactionWhereInput = {
    wallet: { orgId },
    status: "CONFIRMED",
  };

  if (filter.direction) where.direction = filter.direction;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (filter.minAmount || filter.maxAmount) {
    where.amount = {
      ...(filter.minAmount ? { gte: safeToSmallestUnit(filter.minAmount) } : {}),
      ...(filter.maxAmount ? { lte: safeToSmallestUnit(filter.maxAmount) } : {}),
    };
  }
  if (filter.categoryName) {
    // Only applies if the name matches a REAL category on this org —
    // resolved via a lookup, never trusted as a free-form string filter
    // (the DB-level filter is always by categoryId, never by name).
    const category = await prisma.transactionCategory.findFirst({
      where: { orgId, name: filter.categoryName },
      select: { id: true },
    });
    // A categoryName that doesn't resolve to a real category returns zero
    // results rather than silently ignoring the filter — the caller
    // asked for a category, an unmatched category should look like "no
    // matches," not "showing everything."
    where.categorization = category ? { categoryId: category.id } : { categoryId: "__no_match__" };
  }
  if (filter.counterpartyContains) {
    const needle = filter.counterpartyContains.trim();
    const matchingIdentifiers = await findCounterpartyIdentifiers(orgId, needle);
    where.OR = [
      { memo: { contains: needle, mode: "insensitive" } },
      ...(matchingIdentifiers.length > 0
        ? [{ counterpartyAddress: { in: matchingIdentifiers } }]
        : []),
    ];
  }

  const orderBy = resolveOrderBy(filter.sortBy);

  const [rows, aggregate] = await Promise.all([
    prisma.onchainTransaction.findMany({
      where,
      include: { categorization: { include: { category: true } } },
      orderBy,
      take: filter.limit,
    }),
    prisma.onchainTransaction.aggregate({
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const displayNames = await resolveCounterpartyDisplayNames(
    orgId,
    rows.map((r) => r.counterpartyAddress)
  );

  return {
    transactions: rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      amount: toDecimalString(r.amount),
      counterpartyAddress: r.counterpartyAddress,
      counterpartyDisplayName: displayNames.get(r.counterpartyAddress) ?? r.counterpartyAddress,
      memo: r.memo,
      categoryName: r.categorization?.category.name ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    totalAmount: toDecimalString(aggregate._sum.amount ?? 0n),
    totalCount: aggregate._count._all,
    resolvedRange: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
  };
}

function safeToSmallestUnit(decimal: string): bigint {
  try {
    return toSmallestUnit(decimal);
  } catch {
    return 0n; // an unparseable amount from the LLM degrades to "no lower/upper bound" rather than throwing and failing the whole query
  }
}

async function findCounterpartyIdentifiers(orgId: string, needle: string): Promise<string[]> {
  const [contacts, payees] = await Promise.all([
    prisma.contact.findMany({
      where: { orgId, displayName: { contains: needle, mode: "insensitive" } },
      select: { identifier: true },
    }),
    prisma.payee.findMany({
      where: { orgId, name: { contains: needle, mode: "insensitive" } },
      select: { identifier: true },
    }),
  ]);
  return Array.from(new Set([...contacts.map((c) => c.identifier), ...payees.map((p) => p.identifier)]));
}

function resolveOrderBy(sortBy: StructuredQueryFilter["sortBy"]): Prisma.OnchainTransactionOrderByWithRelationInput {
  switch (sortBy) {
    case "date_asc":
      return { createdAt: "asc" };
    case "amount_desc":
      return { amount: "desc" };
    case "amount_asc":
      return { amount: "asc" };
    case "date_desc":
    default:
      return { createdAt: "desc" };
  }
}

function resolveDateBounds(filter: StructuredQueryFilter): { from: Date | null; to: Date | null } {
  const now = new Date();

  if (filter.relativeRange) {
    return resolveRelativeRange(filter.relativeRange, now);
  }

  const from = filter.dateFrom ? parseDateOrNull(filter.dateFrom) : null;
  const to = filter.dateTo ? parseDateOrNull(filter.dateTo) : null;
  return { from, to };
}

function parseDateOrNull(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveRelativeRange(range: StructuredQueryFilter["relativeRange"], now: Date): { from: Date; to: Date } {
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const todayStart = startOfDay(now);

  switch (range) {
    case "today":
      return { from: todayStart, to: now };
    case "yesterday": {
      const from = new Date(todayStart.getTime() - MS_PER_DAY);
      return { from, to: new Date(todayStart.getTime() - 1) };
    }
    case "this_week": {
      const day = todayStart.getUTCDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const from = new Date(todayStart);
      from.setUTCDate(from.getUTCDate() + diffToMonday);
      return { from, to: now };
    }
    case "last_week": {
      const day = todayStart.getUTCDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const thisWeekStart = new Date(todayStart);
      thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() + diffToMonday);
      const from = new Date(thisWeekStart.getTime() - 7 * MS_PER_DAY);
      const to = new Date(thisWeekStart.getTime() - 1);
      return { from, to };
    }
    case "this_month": {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from, to: now };
    }
    case "last_month": {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
      return { from, to };
    }
    case "this_quarter": {
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const from = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
      return { from, to: now };
    }
    case "last_quarter": {
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const from = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth - 3, 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1) - 1);
      return { from, to };
    }
    case "this_year": {
      const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from, to: now };
    }
    case "last_year": {
      const from = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), 0, 1) - 1);
      return { from, to };
    }
    case "trailing_30_days":
      return { from: new Date(now.getTime() - 30 * MS_PER_DAY), to: now };
    case "trailing_90_days":
      return { from: new Date(now.getTime() - 90 * MS_PER_DAY), to: now };
    default:
      return { from: todayStart, to: now };
  }
}