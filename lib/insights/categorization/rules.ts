// lib/insights/categorization/rules.ts
//
// Deterministic categorization — the "most transactions are already
// self-describing via reference_type" half of the spec. Applied BEFORE
// ever calling the LLM; only a transaction this returns null for goes to
// lib/insights/categorization/llmCategorize.ts.
//
// Only referenceType=PAYROLL_RUN has a deterministic rule today.
// SAVINGS_SWEEP, ALLOCATION_RULE, DCA-internal, YIELD_DEPLOYMENT, and
// YIELD_REDEMPTION never reach this function at all in practice — every
// one of those is an internal bucket-to-bucket move
// (transferBetweenLedgerAccounts) with NO OnchainTransaction row, and
// this module only ever runs against OnchainTransaction-anchored
// categorization (see lib/insights/categorization/service.ts). An
// external-facing DCA execution (referenceType DCA with a real onchain
// leg) has no deterministic category — "recurring transfer to an
// external wallet" could be rent, a contractor retainer, personal
// draw, etc. — so it falls through to the LLM like a manual send would.

import type { LedgerReferenceType, OnchainDirection } from "@/app/generated/prisma/client";
import type { CuratedCategoryName } from "./seed";

export interface RuleInput {
  referenceType: LedgerReferenceType | null;
  direction: OnchainDirection;
}

/** Returns a curated category name if a deterministic rule applies, else null (falls through to the LLM). */
export function deriveRuleBasedCategory(input: RuleInput): CuratedCategoryName | null {
  if (input.referenceType === "PAYROLL_RUN") {
    return "Payroll";
  }
  return null;
}