// jobs/confirmTransaction.ts
//
// Polls Circle's transaction status for a single OnchainTransaction until
// it reaches a terminal state (CONFIRMED or FAILED), then reconciles the
// ledger accordingly:
//
//   - CONFIRMED: flip OnchainTransaction.status, stamp confirmedAt. The
//     ledger entry was already recorded at send time (see
//     lib/transfers/send.ts) — nothing to change there.
//   - FAILED: write an OFFSETTING CREDIT ledger entry equal to the
//     original debit. The original debit is never deleted or updated —
//     the ledger is append-only; this is a correction, not a rewrite.
//     Then flag the org for a "payment failed" notification.
//
// Not yet terminal (still QUEUED/SENT/etc): throws, so BullMQ's
// configured backoff (see enqueueConfirmationPolling in
// lib/transfers/send.ts) retries this job automatically. This file also
// exports confirmTransaction() directly so a periodic sweep job or the
// Circle webhook handler can call it without going through the queue.

import { Worker, type Job } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { getTransactionStatus } from "@/lib/circle/wallets";
import type { Prisma } from "@prisma/client/extension";

const SUCCESS_STATES = new Set(["CONFIRMED", "COMPLETE"]);
const FAILURE_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

export interface ConfirmTransactionJobData {
  onchainTransactionId: string;
}

export class TransactionStillPendingError extends Error {
  constructor(circleState: string) {
    super(`Transaction still in state ${circleState}, not yet terminal`);
    this.name = "TransactionStillPendingError";
  }
}

/**
 * Advances one OnchainTransaction based on its current Circle status.
 * Idempotent: safe to call repeatedly, including after the transaction
 * has already reached a terminal state locally (it's a no-op then).
 */
export async function confirmTransaction(onchainTransactionId: string): Promise<void> {
  const onchainTx = await prisma.onchainTransaction.findUnique({
    where: { id: onchainTransactionId },
    include: { wallet: { include: { organization: true } } },
  });

  if (!onchainTx) {
    console.error(`[confirmTransaction] OnchainTransaction ${onchainTransactionId} not found`);
    return;
  }

  if (onchainTx.status !== "PENDING") {
    return; // already resolved — nothing to do
  }

  if (!onchainTx.circleTransactionId) {
    console.error(
      `[confirmTransaction] OnchainTransaction ${onchainTransactionId} has no circleTransactionId, cannot poll`
    );
    return;
  }

  const status = await getTransactionStatus(onchainTx.circleTransactionId);

  if (SUCCESS_STATES.has(status.state)) {
    await prisma.onchainTransaction.update({
      where: { id: onchainTx.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        txHash: status.txHash ?? onchainTx.txHash,
      },
    });
    return;
  }

  if (FAILURE_STATES.has(status.state)) {
    await handleFailedTransaction(onchainTx.id);
    return;
  }

  // Still in flight (INITIATED / PENDING_RISK_SCREENING / QUEUED / SENT).
  throw new TransactionStillPendingError(status.state);
}

async function handleFailedTransaction(onchainTransactionId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const onchainTx = await tx.onchainTransaction.findUnique({
      where: { id: onchainTransactionId },
      include: { wallet: true },
    });
    if (!onchainTx || onchainTx.status !== "PENDING") return; // already handled (idempotency)

    // Find the original debit this send created, to reverse it exactly —
    // never infer the amount independently.
    const originalDebit = await tx.ledgerEntry.findFirst({
      where: { referenceType: "ONCHAIN_TX", referenceId: onchainTransactionId, direction: "DEBIT" },
      orderBy: { createdAt: "asc" },
    });

    await tx.onchainTransaction.update({
      where: { id: onchainTransactionId },
      data: { status: "FAILED" },
    });

    if (originalDebit) {
      await recordEntry(
        {
          ledgerAccountId: originalDebit.ledgerAccountId,
          amount: originalDebit.amount,
          direction: "CREDIT",
          referenceType: "ADJUSTMENT",
          referenceId: onchainTransactionId,
        },
        tx
      );
    } else {
      console.error(
        `[confirmTransaction] No original DEBIT entry found for failed tx ${onchainTransactionId} — nothing to reverse. Investigate.`
      );
    }
  });

  await notifyPaymentFailed(onchainTransactionId);
}

/**
 * Placeholder notification hook — wire up to real email/in-app
 * notifications once that infra exists. Logging loudly in the meantime
 * so failures are at least visible in application logs.
 */
async function notifyPaymentFailed(onchainTransactionId: string): Promise<void> {
  const onchainTx = await prisma.onchainTransaction.findUnique({
    where: { id: onchainTransactionId },
    include: { wallet: { include: { organization: true } } },
  });
  if (!onchainTx) return;

  console.warn(
    `[notify] Payment failed for org ${onchainTx.wallet.organization.id} ` +
      `(onchainTransactionId=${onchainTransactionId}, amount=${onchainTx.amount})`
  );
}

// Only start the worker loop when this file is run directly.
if (require.main === module) {
  const worker = new Worker<ConfirmTransactionJobData>(
    QUEUE_NAMES.CONFIRM_TRANSACTION,
    async (job: Job<ConfirmTransactionJobData>) => {
      await confirmTransaction(job.data.onchainTransactionId);
    },
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job) => {
    console.log(`[confirmTransaction] resolved ${job.data.onchainTransactionId}`);
  });
  worker.on("failed", (job, err) => {
    if (err instanceof TransactionStillPendingError) {
      console.log(`[confirmTransaction] ${job?.data.onchainTransactionId} still pending, will retry`);
    } else {
      console.error(`[confirmTransaction] job failed for ${job?.data.onchainTransactionId}`, err);
    }
  });

  console.log("[confirmTransaction] worker started, listening for jobs...");
}