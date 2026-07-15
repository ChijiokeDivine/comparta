// lib/insights/categorization/seed.ts
//
// The 7 curated SYSTEM categories every org gets, plus the idempotent
// seeding function that ensures they exist. Called lazily (ensured, not
// assumed) at the top of every entry point that needs an org's category
// list — categorization, dashboard queries, NL query translation — so
// there's no separate "run this at org signup" step to forget to wire up.

import { prisma } from "@/lib/db/prisma";
import type { TransactionCategory } from "@/app/generated/prisma/client";

export const CURATED_CATEGORY_NAMES = [
  "Payroll",
  "Software/SaaS",
  "Contractors",
  "Taxes",
  "Savings",
  "Client Refunds",
  "Other",
] as const;

export type CuratedCategoryName = (typeof CURATED_CATEGORY_NAMES)[number];

/**
 * Idempotent: creates any curated categories the org doesn't have yet.
 * Safe to call on every request that needs the category list — after the
 * first call for an org, this is a single read plus a no-op write.
 * Uses createMany + skipDuplicates rather than upsert-per-name so a
 * concurrent double-call (two requests hitting this org's first-ever
 * categorization at once) can never race into a unique-constraint error.
 */
export async function ensureCuratedCategories(orgId: string): Promise<TransactionCategory[]> {
  const existing = await prisma.transactionCategory.findMany({
    where: { orgId, name: { in: [...CURATED_CATEGORY_NAMES] } },
  });
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = CURATED_CATEGORY_NAMES.filter((name) => !existingNames.has(name));

  if (missing.length > 0) {
    await prisma.transactionCategory.createMany({
      data: missing.map((name) => ({ orgId, name, kind: "SYSTEM" as const })),
      skipDuplicates: true,
    });
  }

  return prisma.transactionCategory.findMany({
    where: { orgId, name: { in: [...CURATED_CATEGORY_NAMES] } },
  });
}

/** All active (non-archived) categories for an org, curated + custom, seeding curated ones first if this is the org's first call. */
export async function listActiveCategories(orgId: string): Promise<TransactionCategory[]> {
  await ensureCuratedCategories(orgId);
  return prisma.transactionCategory.findMany({
    where: { orgId, archived: false },
    orderBy: [{ kind: "asc" }, { name: "asc" }], // SYSTEM (curated) before CUSTOM, alpha within each
  });
}