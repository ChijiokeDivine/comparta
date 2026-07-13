// lib/payroll/csvExport.ts
//
// Payroll history CSV export for bookkeeping/tax purposes — per run, per
// payee, or per date range. All three share one row shape and one CSV
// builder so the columns are identical regardless of which slice was
// requested; only the underlying query differs.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { getPayrollRun, PayrollRunNotFoundError } from "./runs";
import { getPayee, PayeeNotFoundError } from "./payees";
import type { Payee, PayrollRun, PayrollRunItem } from "@/app/generated/prisma/client";

export { PayrollRunNotFoundError, PayeeNotFoundError };

const CSV_HEADER = [
  "Run ID",
  "Run Created At",
  "Run Completed At",
  "Payee Name",
  "Payee Identifier",
  "Pay Type",
  "Amount (USDC)",
  "Item Status",
  "Sent At",
  "Confirmed At",
  "Failure Reason",
];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toRow(item: PayrollRunItem & { payee: Payee; payrollRun: PayrollRun }): string[] {
  return [
    item.payrollRun.id,
    item.payrollRun.createdAt.toISOString(),
    item.payrollRun.completedAt?.toISOString() ?? "",
    item.payee.name,
    item.payee.identifier,
    item.payee.payType,
    toDecimalString(item.amount),
    item.status,
    item.sentAt?.toISOString() ?? "",
    item.confirmedAt?.toISOString() ?? "",
    item.failureReason ?? "",
  ];
}

function buildCsv(items: (PayrollRunItem & { payee: Payee; payrollRun: PayrollRun })[]): string {
  const lines = [CSV_HEADER, ...items.map(toRow)];
  return lines.map((row) => row.map(csvEscape).join(",")).join("\n");
}

/** CSV of every line item on a single run. */
export async function exportRunCsv(orgId: string, runId: string): Promise<string> {
  await getPayrollRun(orgId, runId); // ownership check, throws PayrollRunNotFoundError

  const items = await prisma.payrollRunItem.findMany({
    where: { payrollRunId: runId },
    include: { payee: true, payrollRun: true },
    orderBy: { createdAt: "asc" },
  });

  return buildCsv(items);
}

/** CSV of every line item for a single payee, optionally scoped to a date range (by run creation date). */
export async function exportPayeeCsv(
  orgId: string,
  payeeId: string,
  range?: { from?: Date; to?: Date }
): Promise<string> {
  await getPayee(orgId, payeeId); // ownership check, throws PayeeNotFoundError

  const items = await prisma.payrollRunItem.findMany({
    where: {
      payeeId,
      payrollRun: {
        orgId,
        ...(range?.from || range?.to ? { createdAt: { gte: range.from, lte: range.to } } : {}),
      },
    },
    include: { payee: true, payrollRun: true },
    orderBy: { createdAt: "asc" },
  });

  return buildCsv(items);
}

/** CSV of every line item across every run for the org within a date range — the general bookkeeping export. */
export async function exportOrgPayrollCsv(orgId: string, range?: { from?: Date; to?: Date }): Promise<string> {
  const items = await prisma.payrollRunItem.findMany({
    where: {
      payrollRun: {
        orgId,
        ...(range?.from || range?.to ? { createdAt: { gte: range.from, lte: range.to } } : {}),
      },
    },
    include: { payee: true, payrollRun: true },
    orderBy: { createdAt: "asc" },
  });

  return buildCsv(items);
}