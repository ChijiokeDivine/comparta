// lib/dca/execution.ts
//
// Executes ONE due cycle of a RecurringTransfer: creates (or reuses, for
// idempotency) a RecurringTransferExecution row, resolves the
// destination FRESH (never cached — see the module docstring on
// RecurringTransfer in prisma/schema.prisma), calls sendPayment() or
// transferBetweenLedgerAccounts() depending on destination type, and
// records the outcome. This function NEVER throws and NEVER advances
// RecurringTransfer.nextExecutionDate — advancing (regardless of this
// function's outcome) is jobs/processRecurringTransfers.ts's job, since
// that must happen whether this cycle succeeded or failed.

import { nanoid } from "nanoid";
import { prisma } from "@/lib/db/prisma";
import { sendPayment, SendPaymentError } from "@/lib/transfers/send";
import { transferBetweenLedgerAccounts, getBalance } from "@/lib/ledger/engine";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { toDecimalString } from "@/lib/circle/amount";
import {
  notifyRecurringTransferFailed,
  notifyRecurringTransferInsufficientFunds,
} from "@/lib/notifications/dcaNotify";
import type {
  RecurringTransfer,
  RecurringTransferExecutionStatus,
} from "@/app/generated/prisma/client";

export interface ExecuteRecurringTransferResult {
  executionId: string;
  status: RecurringTransferExecutionStatus;
}

const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Executes ONE due cycle of `transfer`, for the given `scheduledDate`
 * (always transfer.nextExecutionDate at the moment the sweep picked it
 * up — passed explicitly rather than re-read, so this stays correct even
 * if nextExecutionDate has since been advanced by the time this runs).
 *
 * Idempotent: if a previous invocation for this exact scheduledDate
 * already created a row (e.g. a worker crash between creating the
 * execution and finishing it), that row is reused rather than
 * double-executing — unless it's been PENDING for more than
 * STALE_PENDING_MS, in which case it's treated as abandoned and retried
 * fresh (a fresh sendPayment call for a stuck PENDING is still safe: the
 * idempotency key below is derived from the execution id, so even a
 * genuinely-in-flight Circle submission from earlier can't be
 * double-submitted).
 */
export async function executeSingleRecurringTransfer(
  transfer: RecurringTransfer,
  scheduledDate: Date
): Promise<ExecuteRecurringTransferResult> {
  const existing = await prisma.recurringTransferExecution.findFirst({
    where: { recurringTransferId: transfer.id, scheduledDate },
    orderBy: { createdAt: "desc" },
  });

  if (existing && existing.status !== "PENDING") {
    return { executionId: existing.id, status: existing.status };
  }
  if (existing && !isStalePending(existing.createdAt)) {
    return { executionId: existing.id, status: existing.status };
  }

  const execution =
    existing ??
    (await prisma.recurringTransferExecution.create({
      data: { recurringTransferId: transfer.id, scheduledDate, status: "PENDING" },
    }));

  // Fast-fail balance check up front — gives a specific
  // FAILED_INSUFFICIENT_FUNDS outcome rather than letting it surface as
  // whatever generic error sendPayment/transferBetweenLedgerAccounts
  // would throw for the same underlying reason.
  const currentBalance = await getBalance(transfer.sourceLedgerAccountId);
  if (currentBalance < transfer.amount) {
    await markExecution(execution.id, "FAILED_INSUFFICIENT_FUNDS", {
      failureReason:
        `Source bucket balance (${toDecimalString(currentBalance)} USDC) is below the scheduled ` +
        `${toDecimalString(transfer.amount)} USDC for this cycle.`,
    });
    notifyRecurringTransferInsufficientFunds(transfer.orgId, transfer.id, execution.id).catch(() => {});
    return { executionId: execution.id, status: "FAILED_INSUFFICIENT_FUNDS" };
  }

  try {
    if (transfer.destinationLedgerAccountId) {
      return await executeInternalTransfer(transfer, execution.id);
    }
    return await executeExternalTransfer(transfer, execution.id);
  } catch (err) {
    // Last-resort safety net — both branches above are written to catch
    // their own known failure modes and never throw, but this guards
    // against anything genuinely unexpected so the execution row still
    // reaches a terminal state rather than being stuck PENDING forever.
    const message = err instanceof Error ? err.message : "Unknown error executing recurring transfer";
    console.error(`[dca] execution ${execution.id} (transfer ${transfer.id}) failed unexpectedly`, err);
    await markExecution(execution.id, "FAILED_OTHER", { failureReason: message });
    notifyRecurringTransferFailed(transfer.orgId, transfer.id, execution.id, message).catch(() => {});
    return { executionId: execution.id, status: "FAILED_OTHER" };
  }
}

async function executeInternalTransfer(
  transfer: RecurringTransfer,
  executionId: string
): Promise<ExecuteRecurringTransferResult> {
  // Internal bucket-to-bucket — no onchain tx, no destination resolution
  // needed at all: the target bucket IS the destination, and buckets
  // can't be "released" or "transferred" the way a username can, so
  // there's no re-resolution edge case on this path.
  const ledgerReferenceId = nanoid();

  try {
    await transferBetweenLedgerAccounts(
      transfer.sourceLedgerAccountId,
      transfer.destinationLedgerAccountId!,
      transfer.amount,
      "DCA",
      ledgerReferenceId
    );
    await markExecution(executionId, "SUCCESS", { executedAt: new Date(), ledgerReferenceId });
    return { executionId, status: "SUCCESS" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error moving funds between buckets";
    console.error(`[dca] internal transfer failed for execution ${executionId}`, err);
    await markExecution(executionId, "FAILED_OTHER", { failureReason: message });
    notifyRecurringTransferFailed(transfer.orgId, transfer.id, executionId, message).catch(() => {});
    return { executionId, status: "FAILED_OTHER" };
  }
}

async function executeExternalTransfer(
  transfer: RecurringTransfer,
  executionId: string
): Promise<ExecuteRecurringTransferResult> {
  // Resolve FRESH, every single time — never reuse a resolution from a
  // prior cycle or from setup time. A username can be released,
  // transferred, or repointed between creation and any given execution;
  // this cycle must send to whoever/whatever the identifier currently
  // points to, or fail loudly (this specific edge case) if it no longer
  // resolves at all.
  try {
    await resolve(transfer.destinationIdentifier!);
  } catch (err) {
    if (err instanceof ResolverError) {
      const message = `Recipient "${transfer.destinationIdentifier}" could not be resolved: ${err.message}`;
      await markExecution(executionId, "FAILED_OTHER", { failureReason: message });
      notifyRecurringTransferFailed(transfer.orgId, transfer.id, executionId, message).catch(() => {});
      return { executionId, status: "FAILED_OTHER" };
    }
    throw err;
  }

  try {
    const sendResult = await sendPayment({
      orgId: transfer.orgId,
      fromLedgerAccountId: transfer.sourceLedgerAccountId,
      toIdentifier: transfer.destinationIdentifier!,
      amount: toDecimalString(transfer.amount),
      memo: transfer.name ? `Recurring transfer: ${transfer.name}` : "Recurring transfer",
      referenceType: "DCA",
      referenceId: executionId,
      // Deterministic per-execution key — a retried job for the SAME
      // execution (BullMQ attempt retry, or this function's own
      // stale-PENDING retry path) never double-submits to Circle.
      idempotencyKey: `dca-execution-${executionId}`,
    });

    await markExecution(executionId, "SUCCESS", {
      executedAt: new Date(),
      txId: sendResult.onchainTransactionId,
    });
    return { executionId, status: "SUCCESS" };
  } catch (err) {
    const isInsufficient = err instanceof SendPaymentError && err.code === "INSUFFICIENT_BALANCE";
    const status: RecurringTransferExecutionStatus = isInsufficient
      ? "FAILED_INSUFFICIENT_FUNDS"
      : "FAILED_OTHER";
    const message =
      err instanceof SendPaymentError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error executing recurring transfer";

    console.error(`[dca] send failed for execution ${executionId}`, err);
    await markExecution(executionId, status, { failureReason: message });

    if (isInsufficient) {
      notifyRecurringTransferInsufficientFunds(transfer.orgId, transfer.id, executionId).catch(() => {});
    } else {
      notifyRecurringTransferFailed(transfer.orgId, transfer.id, executionId, message).catch(() => {});
    }
    return { executionId, status };
  }
}

function isStalePending(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > STALE_PENDING_MS;
}

async function markExecution(
  executionId: string,
  status: RecurringTransferExecutionStatus,
  fields: { executedAt?: Date; txId?: string; ledgerReferenceId?: string; failureReason?: string }
): Promise<void> {
  await prisma.recurringTransferExecution.update({
    where: { id: executionId },
    data: { status, ...fields },
  });
}