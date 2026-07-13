// jobs/executePayroll.ts
//
// Executes an approved (PROCESSING) PayrollRun: iterates its
// PayrollRunItem rows and calls sendPayment() for each, sourcing from
// PayrollRun.sourceLedgerAccountId. This is the ONLY module that ever
// moves money for payroll — lib/payroll/runs.ts gets a run to PROCESSING
// and enqueues this job, but never calls sendPayment() itself.
//
// Sequential, not parallel, with per-item error isolation: one payee's
// failed payment (bad identifier, provider error, mid-run balance race)
// must never block or roll back the others. Each item gets its own
// try/catch inside the loop — a thrown SendPaymentError is caught,
// recorded on that item, and the loop moves on to the next payee.
//
// Idempotent / safe to re-run: items already in a terminal state (SENT,
// CONFIRMED, FAILED) or flagged with identifierIssue are skipped, so
// calling this again on a partially-executed run (e.g. after a worker
// crash mid-run) only processes the items still PENDING.
//
// Onchain confirmation (PENDING -> CONFIRMED/FAILED on the underlying
// OnchainTransaction) happens asynchronously via the existing
// jobs/confirmTransaction.ts poller, same as every other outbound send.
// See lib/payroll/completion.ts for the hook that mirrors that
// resolution back onto the PayrollRunItem.

import { Worker, type Job } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { sendPayment, SendPaymentError } from "@/lib/transfers/send";
import { toDecimalString } from "@/lib/circle/amount";
import type { PayrollRunItem } from "@/app/generated/prisma/client";

export interface ExecutePayrollJobData {
  payrollRunId: string;
}

export interface ExecutePayrollRunResult {
  payrollRunId: string;
  itemsProcessed: number;
  itemsSent: number;
  itemsFailed: number;
  itemsSkipped: number;
}

/**
 * Advances one PayrollRunItem: submits sendPayment(), then records
 * SENT/txId or FAILED/failureReason. Never throws — failures are fully
 * captured on the item so the caller's loop can move on unconditionally.
 */
async function executeSingleItem(
  item: PayrollRunItem,
  orgId: string,
  sourceLedgerAccountId: string,
  payeeIdentifier: string,
  payeeName: string
): Promise<"SENT" | "FAILED"> {
  try {
    const result = await sendPayment({
      orgId,
      fromLedgerAccountId: sourceLedgerAccountId,
      toIdentifier: payeeIdentifier,
      amount: toDecimalString(item.amount),
      memo: `Payroll: ${payeeName}`,
      referenceType: "PAYROLL_RUN",
      referenceId: item.id,
      // Deterministic per-item key: a retried job for the same item
      // (e.g. BullMQ's own attempt retries) never double-submits to
      // Circle for the same disbursement.
      idempotencyKey: `payroll-item-${item.id}`,
    });

    await prisma.payrollRunItem.update({
      where: { id: item.id },
      data: { status: "SENT", txId: result.onchainTransactionId, sentAt: new Date(), failureReason: null },
    });
    return "SENT";
  } catch (err) {
    const message =
      err instanceof SendPaymentError
        ? err.message
        : err instanceof Error
          ? `Unexpected error: ${err.message}`
          : "Unknown error sending payment";

    console.error(`[executePayroll] item ${item.id} (payee ${payeeName}) failed`, err);

    await prisma.payrollRunItem
      .update({ where: { id: item.id }, data: { status: "FAILED", failureReason: message } })
      .catch((updateErr) =>
        console.error(`[executePayroll] CRITICAL: failed to record failure for item ${item.id}`, updateErr)
      );
    return "FAILED";
  }
}

/**
 * Executes every not-yet-terminal item on a PROCESSING run, sequentially.
 * Safe to call directly (not just via the queue) — e.g. for manual
 * recovery after a failed enqueue (see lib/payroll/runs.ts#approveRun).
 */
export async function executePayrollRun(payrollRunId: string): Promise<ExecutePayrollRunResult> {
  const run = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    include: { items: { include: { payee: true }, orderBy: { createdAt: "asc" } } },
  });

  if (!run) {
    console.error(`[executePayroll] PayrollRun ${payrollRunId} not found`);
    return { payrollRunId, itemsProcessed: 0, itemsSent: 0, itemsFailed: 0, itemsSkipped: 0 };
  }

  if (run.status !== "PROCESSING") {
    // Already completed (or never approved) — idempotent no-op so a
    // duplicate/retried job never re-sends money.
    console.log(`[executePayroll] run ${payrollRunId} is ${run.status}, not PROCESSING — skipping.`);
    return { payrollRunId, itemsProcessed: 0, itemsSent: 0, itemsFailed: 0, itemsSkipped: run.items.length };
  }

  let itemsSent = 0;
  let itemsFailed = 0;
  let itemsSkipped = 0;

  for (const item of run.items) {
    if (item.identifierIssue) {
      // Should never reach PROCESSING with an unresolved identifier —
      // approveRun() blocks that — but guard defensively in case the
      // run was force-approved or the item was edited out of band.
      itemsSkipped++;
      continue;
    }
    if (item.status === "SENT" || item.status === "CONFIRMED") {
      // Already handled by a previous execution attempt.
      itemsSkipped++;
      continue;
    }

    const outcome = await executeSingleItem(
      item,
      run.orgId,
      run.sourceLedgerAccountId,
      item.payee.identifier,
      item.payee.name
    );
    if (outcome === "SENT") itemsSent++;
    else itemsFailed++;
  }

  await prisma.payrollRun.update({
    where: { id: payrollRunId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return { payrollRunId, itemsProcessed: itemsSent + itemsFailed, itemsSent, itemsFailed, itemsSkipped };
}

/**
 * Manual retry for a single FAILED item (identifier issues are NOT
 * retryable here — fix the payee or remove the item from the run
 * instead). Resets the item and re-attempts sendPayment() in isolation,
 * without touching any other item on the run.
 */
export async function retryPayrollRunItem(orgId: string, payrollRunId: string, itemId: string): Promise<void> {
  const item = await prisma.payrollRunItem.findFirst({
    where: { id: itemId, payrollRunId },
    include: { payee: true, payrollRun: true },
  });
  if (!item || item.payrollRun.orgId !== orgId) {
    throw new Error("Payroll run item not found.");
  }
  if (item.payrollRun.status !== "PROCESSING" && item.payrollRun.status !== "COMPLETED") {
    throw new Error(`Only items on a processing or completed run can be retried (this run is ${item.payrollRun.status}).`);
  }
  if (item.status !== "FAILED") {
    throw new Error(`Only a FAILED item can be retried (this item is ${item.status}).`);
  }
  if (item.identifierIssue) {
    throw new Error("This item's payee identifier could not be resolved. Fix the payee's identifier, then retry.");
  }

  // Clear the prior failed attempt's txId (if any onchain tx was ever
  // created for it) so a fresh sendPayment() gets its own
  // OnchainTransaction row rather than colliding on the @unique txId.
  await prisma.payrollRunItem.update({
    where: { id: itemId },
    data: { status: "PENDING", txId: null, failureReason: null },
  });

  const outcome = await executeSingleItem(
    { ...item, status: "PENDING" },
    orgId,
    item.payrollRun.sourceLedgerAccountId,
    item.payee.identifier,
    item.payee.name
  );

  // If every item on the run is now terminal and the run had been left
  // COMPLETED from a prior pass, no further action needed — COMPLETED
  // already reflects "execution has finished", not "everything
  // succeeded". Nothing else to reconcile here.
  void outcome;
}

// Only start the worker loop when this file is run directly (not when
// imported for its executePayrollRun/retryPayrollRunItem exports, e.g.
// from lib/payroll/runs.ts or an API route).
if (require.main === module) {
  const worker = new Worker<ExecutePayrollJobData>(
    QUEUE_NAMES.PAYROLL_RUN,
    async (job: Job<ExecutePayrollJobData>) => executePayrollRun(job.data.payrollRunId),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[executePayroll] run ${job.data.payrollRunId} finished`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[executePayroll] run ${job?.data.payrollRunId} job errored`, err);
  });

  console.log("[executePayroll] worker started, listening for jobs...");
}