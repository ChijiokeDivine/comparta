// lib/notifications/dcaNotify.ts
//
// Placeholder notification hooks for DCA / recurring transfers — same
// pattern and posture as lib/notifications/notify.ts: wire up to real
// email/in-app infra once it exists, logging loudly in the meantime.
// Every function here is deliberately best-effort — callers always
// .catch() at the call site (see lib/dca/execution.ts) rather than let a
// notification failure affect the underlying execution's recorded
// outcome.

export async function notifyRecurringTransferInsufficientFunds(
  orgId: string,
  recurringTransferId: string,
  executionId: string
): Promise<void> {
  console.log(
    `[notify] TODO: notify org ${orgId} — recurring transfer ${recurringTransferId} skipped this cycle ` +
      `(execution ${executionId}): insufficient funds in the source bucket. The schedule was NOT cancelled ` +
      `and will attempt again next cycle.`
  );
}

export async function notifyRecurringTransferFailed(
  orgId: string,
  recurringTransferId: string,
  executionId: string,
  reason: string
): Promise<void> {
  console.log(
    `[notify] TODO: notify org ${orgId} — recurring transfer ${recurringTransferId} failed this cycle ` +
      `(execution ${executionId}): ${reason}. The schedule was NOT cancelled and will attempt again next cycle.`
  );
}

/** Sent once a recurring transfer reaches its endDate and auto-completes. */
export async function notifyRecurringTransferCompleted(
  orgId: string,
  recurringTransferId: string
): Promise<void> {
  console.log(
    `[notify] TODO: notify org ${orgId} — recurring transfer ${recurringTransferId} has reached its end date ` +
      `and is now COMPLETED.`
  );
}