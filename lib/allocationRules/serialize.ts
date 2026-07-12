// lib/allocationRules/serialize.ts
//
// AllocationRule.value is bigint (basis points for PERCENTAGE, smallest
// USDC unit for FIXED_AMOUNT) — same JSON-serialization problem as every
// other money-adjacent bigint in this codebase (see
// lib/paymentLinks/serialize.ts, lib/invoices/serialize.ts). Every API
// route returning a rule or an execution must go through here first.
//
// `value` is surfaced two ways so the UI never has to know the
// basis-points convention: `value` stays raw (for round-tripping back
// into an edit form as-is) and `displayValue` is pre-formatted human
// units ("20.00" meaning 20% for PERCENTAGE, "150.00" USDC for
// FIXED_AMOUNT).

import { toDecimalString } from "@/lib/circle/amount";
import { basisPointsToPercentageString } from "./service";
import type { AllocationRule, AllocationRuleExecution } from "@/app/generated/prisma/client";

export function serializeAllocationRule(rule: AllocationRule) {
  return {
    ...rule,
    value: rule.value.toString(),
    displayValue: rule.ruleType === "PERCENTAGE" ? basisPointsToPercentageString(rule.value) : toDecimalString(rule.value),
  };
}

export function serializeAllocationRuleExecution(execution: AllocationRuleExecution) {
  return {
    ...execution,
    amountAllocated: toDecimalString(execution.amountAllocated),
  };
}
