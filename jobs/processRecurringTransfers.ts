// jobs/processRecurringTransfers.ts
//
// Sweep: finds every ACTIVE RecurringTransfer whose nextExecutionDate is
// due, executes it via lib/dca/execution.ts#executeSingleRecurringTransfer,
// and ALWAYS advances nextExecutionDate by one frequency interval
// afterward — regardless of whether that execution succeeded, failed
// for insufficient funds, or failed for any other reason. A failed cycle
// is surfaced via RecurringTransferExecution + lib/notifications/dcaNotify.ts,
// never retried immediately, and never blocks the next scheduled cycle.
// Run this AT LEAST hourly (a repeatable BullMQ job or external cron) —
// see the spec's own requirement; nothing here assumes a particular
// interval beyond "frequently enough that DAILY transfers stay
// reasonably on-time."
//
// PAUSED/CANCELLED/COMPLETED transfers are excluded by the query itself
// (status: "ACTIVE"). This is also the resolution for the "pausing
// mid-cycle" edge case: even a transfer whose nextExecutionDate is far
// in the past (paused for a while, never resumed) simply never matches
// this query until it's ACTIVE again — nothing outside this sweep ever
// executes a transfer, so there's no second code path that could
// accidentally skip the status check.
//
// endDate handling: if the DUE cycle's scheduledDate itself already
// falls after endDate (a schedule that should have already retired), it
// is marked COMPLETED without executing at all. Otherwise, if executing
// this cycle and advancing nextExecutionDate would land past endDate,
// the transfer is marked COMPLETED right after this cycle runs — so the
// very last in-range cycle still executes, and the transfer retires
// cleanly afterward. COMPLETED is deliberately distinct from CANCELLED
// (user-initiated) so the two are distinguishable in execution history.
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/processRecurringTransfers.ts`), separate from the Next.js server.
// Schedule via QUEUE_NAMES.RECURRING_TRANSFER_SWEEP (a BullMQ repeatable
// job, e.g. hourly) or an external cron hitting a protected internal
// endpoint that calls runRecurringTransferSweep().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { executeSingleRecurringTransfer } from "@/lib/dca/execution";
import { computeNextExecutionDate } from "@/lib/dca/schedule";
import { notifyRecurringTransferCompleted } from "@/lib/notifications/dcaNotify";
import type { RecurringTransfer } from "@/app/generated/prisma/client";

export interface RecurringTransferSweepResult {
  transfersEvaluated: number;
  succeeded: number;
  failed: number;
  completed: number; // transfers that retired (hit endDate) this sweep
}

export async function runRecurringTransferSweep(
  now = new Date()
): Promise<RecurringTransferSweepResult> {
  const dueTransfers = await prisma.recurringTransfer.findMany({
    where: { status: "ACTIVE", nextExecutionDate: { lte: now } },
    orderBy: { nextExecutionDate: "asc" },
  });

  let succeeded = 0;
  let failed = 0;
  let completed = 0;

  for (const transfer of dueTransfers) {
    const scheduledDate = transfer.nextExecutionDate;

    // Already past its end date entirely — retire without executing.
    // (Shouldn't normally happen since the sweep runs at least hourly,
    // but guards against a long gap in sweep execution, e.g. the worker
    // being down for a while.)
    if (transfer.endDate && scheduledDate.getTime() > transfer.endDate.getTime()) {
      await completeIfStillDue(transfer, scheduledDate);
      completed++;
      continue;
    }

    const result = await executeSingleRecurringTransfer(transfer, scheduledDate).catch((err) => {
      // executeSingleRecurringTransfer is designed to never throw (every
      // outcome is captured on the execution row) — this catch is a
      // last-resort safety net so a truly unexpected error still lets
      // nextExecutionDate advance rather than wedging the schedule.
      console.error(
        `[processRecurringTransfers] unexpected error executing transfer ${transfer.id}, advancing schedule anyway`,
        err
      );
      return { executionId: "unknown", status: "FAILED_OTHER" as const };
    });

    if (result.status === "SUCCESS") succeeded++;
    else failed++;

    const becameCompleted = await advanceOrComplete(transfer, scheduledDate);
    if (becameCompleted) completed++;
  }

  return { transfersEvaluated: dueTransfers.length, succeeded, failed, completed };
}

/**
 * Advances nextExecutionDate by one frequency interval, or — if that
 * would land past endDate — marks the transfer COMPLETED instead.
 * Guarded so this only applies if nextExecutionDate still equals the
 * cycle we just handled (avoids clobbering a date/status some other
 * process already changed, e.g. a concurrent sweep invocation or the
 * user cancelling mid-sweep). Returns true if the transfer became
 * COMPLETED as a result.
 */
async function advanceOrComplete(
  transfer: RecurringTransfer,
  scheduledDate: Date
): Promise<boolean> {
  const nextExecutionDate = computeNextExecutionDate(scheduledDate, transfer.frequency);
  const pastEndDate =
    transfer.endDate !== null && nextExecutionDate.getTime() > transfer.endDate.getTime();

  const { count } = await prisma.recurringTransfer.updateMany({
    where: { id: transfer.id, nextExecutionDate: scheduledDate, status: "ACTIVE" },
    data: pastEndDate ? { status: "COMPLETED", nextExecutionDate } : { nextExecutionDate },
  });

  if (count > 0 && pastEndDate) {
    notifyRecurringTransferCompleted(transfer.orgId, transfer.id).catch(() => {});
    return true;
  }
  return false;
}

/** Used for the "already past endDate, never executed" branch above — same guard posture as advanceOrComplete. */
async function completeIfStillDue(transfer: RecurringTransfer, scheduledDate: Date): Promise<void> {
  const { count } = await prisma.recurringTransfer.updateMany({
    where: { id: transfer.id, nextExecutionDate: scheduledDate, status: "ACTIVE" },
    data: { status: "COMPLETED" },
  });
  if (count > 0) {
    notifyRecurringTransferCompleted(transfer.orgId, transfer.id).catch(() => {});
  }
}

// Only start the worker loop when this file is run directly (not when
// imported for its runRecurringTransferSweep export, e.g. from an
// internal cron-triggered API route).
if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.RECURRING_TRANSFER_SWEEP,
    async () => runRecurringTransferSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[processRecurringTransfers] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[processRecurringTransfers] sweep failed`, err);
  });

  console.log("[processRecurringTransfers] worker started, listening for jobs...");
}