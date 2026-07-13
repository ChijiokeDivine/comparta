// lib/savings/serialize.ts
//
// bigint JSON-serialization for savings-feature API responses, same
// convention as lib/allocationRules/serialize.ts. Every API route
// returning a SavingsRule, SavingsRuleExecution, YieldPosition, or
// YieldRedemptionRequest must go through here first — bigint doesn't
// survive JSON.stringify on its own.
//
// `value` on SavingsRule is surfaced two ways so the UI never has to
// know the trigger-dependent unit convention: `value` stays raw (basis
// points for PERCENTAGE_OF_INCOME, smallest USDC unit for ROUND_UP /
// FIXED_RECURRING — for round-tripping back into an edit form as-is) and
// `displayValue` is pre-formatted human units ("10.00" meaning 10% for
// PERCENTAGE_OF_INCOME, "10.00" USDC for ROUND_UP / FIXED_RECURRING).

import { toDecimalString } from "@/lib/circle/amount";
import { basisPointsToPercentageString } from "@/lib/allocationRules/service";
import type {
  SavingsRule,
  SavingsRuleExecution,
  YieldPosition,
  YieldRedemptionRequest,
} from "@/app/generated/prisma/client";

export function serializeSavingsRule(rule: SavingsRule) {
  const displayValue =
    rule.trigger === "PERCENTAGE_OF_INCOME"
      ? basisPointsToPercentageString(rule.value)
      : toDecimalString(rule.value);

  return { ...rule, value: rule.value.toString(), displayValue };
}

export function serializeSavingsRuleExecution(execution: SavingsRuleExecution) {
  return { ...execution, amountSwept: toDecimalString(execution.amountSwept) };
}

export function serializeYieldPosition(position: YieldPosition) {
  return {
    ...position,
    usycAmount: position.usycAmount.toString(),
    usdcEquivalentAtDeploy: toDecimalString(position.usdcEquivalentAtDeploy),
  };
}

export function serializeYieldRedemptionRequest(request: YieldRedemptionRequest) {
  return {
    ...request,
    usycAmountRequested: request.usycAmountRequested.toString(),
    usdcAmountSettled:
      request.usdcAmountSettled !== null ? toDecimalString(request.usdcAmountSettled) : null,
  };
}