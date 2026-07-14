// lib/dca/serialize.ts
//
// bigint JSON-serialization for DCA API responses, same convention as
// lib/allocationRules/serialize.ts / lib/savings/serialize.ts.

import { toDecimalString } from "@/lib/circle/amount";
import type {
  RecurringTransfer,
  RecurringTransferExecution,
} from "@/app/generated/prisma/client";

export function serializeRecurringTransfer(transfer: RecurringTransfer) {
  return { ...transfer, amount: toDecimalString(transfer.amount) };
}

// No bigint fields on RecurringTransferExecution (the amount is fixed on
// the parent RecurringTransfer) — this exists mainly so callers have one
// consistent serialize* entry point per model, matching every other
// phase's convention, and as a stable seam if a per-execution amount
// override is ever added later.
export function serializeRecurringTransferExecution(execution: RecurringTransferExecution) {
  return { ...execution };
}