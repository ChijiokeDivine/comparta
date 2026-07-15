// lib/insights/categorization/service.ts
//
// Orchestrates categorization for a single OnchainTransaction: try the
// deterministic rule first (lib/insights/categorization/rules.ts), fall
// back to the LLM (lib/insights/categorization/llmCategorize.ts) if no
// rule matches, and persist exactly one TransactionCategorization row
// per transaction (see the model's schema comment for why this is an
// upsert-style "current state" row rather than an append-only log).
//
// This module is the ONLY place that writes TransactionCategorization —
// mirrors every other "one module owns one table" convention in this
// codebase (lib/ledger/engine.ts for LedgerEntry, lib/savings/yield.ts
// for YieldPosition, etc.).

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { resolveCounterpartyDisplayName } from "@/lib/insights/counterparty";
import { ensureCuratedCategories, listActiveCategories } from "./seed";
import { deriveRuleBasedCategory } from "./rules";
import { suggestCategoryViaLLM } from "./llmCategorize";
import type { TransactionCategorization, TransactionCategory } from "@/app/generated/prisma/client";

export class InsightsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightsValidationError";
  }
}

export class CategorizationNotFoundError extends Error {
  constructor() {
    super("Categorization not found");
    this.name = "CategorizationNotFoundError";
  }
}

// LLM suggestions at or above this confidence auto-apply with no user
// action needed; below it, the suggestion is still applied (so every
// transaction has SOME category the moment it's processed — the
// dashboard is never missing data) but flagged needsConfirmation=true
// for one-tap accept/override, per the spec's "surface low-confidence
// suggestions... rather than silently auto-applying them."
export const CONFIDENCE_THRESHOLD_BPS = 7000; // 70%

/**
 * Categorizes ONE OnchainTransaction. Idempotent by default — if it
 * already has a categorization, returns the existing row unchanged
 * unless `force` is true (e.g. an admin "re-run categorization" action).
 * Never throws for a categorization-quality reason (LLM failure falls
 * back to "Other"/0% via llmCategorize.ts's own fallback) — only throws
 * if the transaction itself doesn't exist.
 */
export async function categorizeTransaction(
  onchainTransactionId: string,
  options: { force?: boolean } = {}
): Promise<TransactionCategorization> {
  const tx = await prisma.onchainTransaction.findUnique({
    where: { id: onchainTransactionId },
    include: { wallet: { select: { orgId: true } }, categorization: true },
  });
  if (!tx) {
    throw new InsightsValidationError(`OnchainTransaction ${onchainTransactionId} not found.`);
  }
  if (tx.categorization && !options.force) {
    return tx.categorization;
  }

  const orgId = tx.wallet.orgId;

  const ruleCategoryName = deriveRuleBasedCategory({
    referenceType: tx.referenceType,
    direction: tx.direction,
  });

  if (ruleCategoryName) {
    const category = await getOrCreateNamedCategory(orgId, ruleCategoryName);
    return upsertCategorization(orgId, onchainTransactionId, {
      categoryId: category.id,
      source: "RULE",
      confidenceBps: null,
      needsConfirmation: false,
      llmSuggestedCategoryName: null,
      llmReasoning: null,
    });
  }

  const categories = await listActiveCategories(orgId);
  const displayName = await resolveCounterpartyDisplayName(orgId, tx.counterpartyAddress);

  const suggestion = await suggestCategoryViaLLM({
    counterpartyDisplayName: displayName,
    memo: tx.memo,
    amount: toDecimalString(tx.amount),
    direction: tx.direction,
    date: tx.createdAt.toISOString(),
    availableCategories: categories.map((c) => c.name),
  });

  const category = await getOrCreateNamedCategory(orgId, suggestion.categoryName);
  const needsConfirmation = suggestion.confidenceBps < CONFIDENCE_THRESHOLD_BPS;

  return upsertCategorization(orgId, onchainTransactionId, {
    categoryId: category.id,
    source: "LLM",
    confidenceBps: suggestion.confidenceBps,
    needsConfirmation,
    llmSuggestedCategoryName: suggestion.categoryName,
    llmReasoning: suggestion.reasoning,
  });
}

async function getOrCreateNamedCategory(orgId: string, name: string): Promise<TransactionCategory> {
  await ensureCuratedCategories(orgId); // covers the "Other" fallback and every other curated name
  const existing = await prisma.transactionCategory.findFirst({ where: { orgId, name } });
  if (existing) return existing;
  // A category name outside the curated set that doesn't exist yet as a
  // CUSTOM category either — shouldn't happen given llmCategorize.ts's
  // allow-list enforcement, but create it defensively rather than crash
  // a categorization run over a naming edge case.
  return prisma.transactionCategory.create({ data: { orgId, name, kind: "CUSTOM" } });
}

interface UpsertCategorizationFields {
  categoryId: string;
  source: "RULE" | "LLM" | "MANUAL";
  confidenceBps: number | null;
  needsConfirmation: boolean;
  llmSuggestedCategoryName: string | null;
  llmReasoning: string | null;
}

async function upsertCategorization(
  orgId: string,
  onchainTransactionId: string,
  fields: UpsertCategorizationFields
): Promise<TransactionCategorization> {
  return prisma.transactionCategorization.upsert({
    where: { onchainTransactionId },
    create: { orgId, onchainTransactionId, ...fields },
    update: {
      categoryId: fields.categoryId,
      source: fields.source,
      confidenceBps: fields.confidenceBps,
      needsConfirmation: fields.needsConfirmation,
      // Preserve the ORIGINAL llm suggestion fields on every update
      // except when this update itself IS a fresh LLM run (force
      // re-categorization) — a MANUAL override should never blank out
      // what the LLM originally said, since that's the audit trail
      // lib/insights/categorization for eval purposes depends on.
      ...(fields.source === "LLM"
        ? { llmSuggestedCategoryName: fields.llmSuggestedCategoryName, llmReasoning: fields.llmReasoning }
        : {}),
      confirmedAt: fields.needsConfirmation ? null : new Date(),
    },
  });
}

// ── user-facing actions ─────────────────────────────────────────────────

export async function listPendingCategorizations(orgId: string) {
  return prisma.transactionCategorization.findMany({
    where: { orgId, needsConfirmation: true },
    include: { category: true, onchainTransaction: true },
    orderBy: { createdAt: "desc" },
  });
}

/** One-tap accept: the LLM's suggested category is correct as-is — clears needsConfirmation, no category change. */
export async function confirmCategorization(
  orgId: string,
  categorizationId: string
): Promise<TransactionCategorization> {
  const existing = await prisma.transactionCategorization.findFirst({
    where: { id: categorizationId, orgId },
  });
  if (!existing) throw new CategorizationNotFoundError();

  return prisma.transactionCategorization.update({
    where: { id: categorizationId },
    data: { needsConfirmation: false, confirmedAt: new Date() },
  });
}

/** Override by categorization id — used from the pending-confirmation queue when the LLM's suggestion was wrong. */
export async function overrideCategorization(
  orgId: string,
  categorizationId: string,
  categoryId: string
): Promise<TransactionCategorization> {
  const existing = await prisma.transactionCategorization.findFirst({
    where: { id: categorizationId, orgId },
  });
  if (!existing) throw new CategorizationNotFoundError();

  await assertCategoryBelongsToOrg(orgId, categoryId);

  return prisma.transactionCategorization.update({
    where: { id: categorizationId },
    data: { categoryId, source: "MANUAL", needsConfirmation: false, confirmedAt: new Date() },
  });
}

/**
 * Sets/changes the category for ANY already-categorized transaction
 * directly by transaction id — the general "change category" action a
 * UI would wire to a dropdown on any transaction row, independent of
 * whether it was ever pending confirmation.
 */
export async function setTransactionCategory(
  orgId: string,
  onchainTransactionId: string,
  categoryId: string
): Promise<TransactionCategorization> {
  await assertCategoryBelongsToOrg(orgId, categoryId);

  const tx = await prisma.onchainTransaction.findFirst({
    where: { id: onchainTransactionId, wallet: { orgId } },
  });
  if (!tx) {
    throw new InsightsValidationError("Transaction not found on this organization.");
  }

  return prisma.transactionCategorization.upsert({
    where: { onchainTransactionId },
    create: {
      orgId,
      onchainTransactionId,
      categoryId,
      source: "MANUAL",
      needsConfirmation: false,
      confirmedAt: new Date(),
    },
    update: { categoryId, source: "MANUAL", needsConfirmation: false, confirmedAt: new Date() },
  });
}

async function assertCategoryBelongsToOrg(orgId: string, categoryId: string): Promise<void> {
  const category = await prisma.transactionCategory.findFirst({ where: { id: categoryId, orgId } });
  if (!category) {
    throw new InsightsValidationError("Category not found on this organization.");
  }
}

// ── category CRUD (custom categories only — SYSTEM ones are seed-managed) ──

export async function createCustomCategory(orgId: string, name: string): Promise<TransactionCategory> {
  const trimmed = name.trim();
  if (!trimmed) throw new InsightsValidationError("Category name cannot be empty.");
  if (trimmed.length > 60) throw new InsightsValidationError("Category name is too long (max 60 characters).");

  try {
    return await prisma.transactionCategory.create({
      data: { orgId, name: trimmed, kind: "CUSTOM" },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new InsightsValidationError(`A category named "${trimmed}" already exists.`);
    }
    throw err;
  }
}

export async function archiveCustomCategory(orgId: string, categoryId: string): Promise<TransactionCategory> {
  const category = await prisma.transactionCategory.findFirst({ where: { id: categoryId, orgId } });
  if (!category) throw new InsightsValidationError("Category not found on this organization.");
  if (category.kind === "SYSTEM") {
    throw new InsightsValidationError("Curated categories can't be archived.");
  }
  return prisma.transactionCategory.update({ where: { id: categoryId }, data: { archived: true } });
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}