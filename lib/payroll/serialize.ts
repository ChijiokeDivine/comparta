// lib/payroll/serialize.ts
//
// Payee.defaultAmount, PayrollRun.totalAmount, and PayrollRunItem.amount
// are all bigint (smallest USDC unit) — same JSON-serialization problem
// as every other money-adjacent bigint in this codebase (see
// lib/allocationRules/serialize.ts, lib/paymentLinks/serialize.ts).
// Every API route returning one of these rows must go through here
// first.

import { toDecimalString } from "@/lib/circle/amount";
import type { Payee, PayrollSchedule, PayrollRun, PayrollRunItem } from "@/app/generated/prisma/client";

export function serializePayee(payee: Payee) {
  return {
    ...payee,
    defaultAmount: payee.defaultAmount !== null ? toDecimalString(payee.defaultAmount) : null,
  };
}

export function serializePayrollSchedule(schedule: PayrollSchedule) {
  return { ...schedule };
}

export function serializePayrollRunItem(item: PayrollRunItem & { payee?: Payee }) {
  return {
    ...item,
    amount: toDecimalString(item.amount),
    payee: item.payee ? serializePayee(item.payee) : undefined,
  };
}

export function serializePayrollRun(
  run: PayrollRun & { items?: (PayrollRunItem & { payee?: Payee })[] }
) {
  return {
    ...run,
    totalAmount: toDecimalString(run.totalAmount),
    items: run.items?.map(serializePayrollRunItem),
  };
}