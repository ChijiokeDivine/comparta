// jobs/confirmYieldRedemption.ts
//
// Polls Circle's USYC conversion status for a single
// YieldRedemptionRequest until it reaches a terminal state, then
// reconciles both the YieldPosition (reduces usycAmount, marks REDEEMED
// if it hits exactly zero) and the bucket's ledger (CREDITs the settled
// USDC back as spendable balance). Mirrors jobs/confirmTransaction.ts's
// polling/backoff pattern exactly — "near-instant" is still modeled as
// async, per the product requirement that the UI show PENDING/PROCESSING
// states rather than assume synchronous success.
//
// Idempotent: safe to call repeatedly, including after the request has
// already reached a terminal state locally (a no-op then) — matters
// because BullMQ retries and a possible future webhook path could both
// invoke this for the same request.

import { Worker, type Job } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { getUsycConversionStatus } from "@/lib/circle/usyc";
import { toSmallestUnit } from "@/lib/circle/amount";
import { usycToUsdc } from "@/lib/savings/yield";
import type { Prisma } from "@/app/generated/prisma/client";

const SUCCESS_STATES = new Set(["COMPLETE", "COMPLETED", "CONFIRMED"]);
const FAILURE_STATES = new Set(["FAILED", "CANCELLED", "DENIED", "REJECTED"]);

export interface ConfirmYieldRedemptionJobData {
  yieldRedemptionRequestId: string;
}

export class RedemptionStillPendingError extends Error {
  constructor(state: string) {
    super(`Redemption still in state ${state}, not yet terminal`);
    this.name = "RedemptionStillPendingError";
  }
}

/**
 * Advances one YieldRedemptionRequest based on its current Circle
 * conversion status. Idempotent — a no-op if the request is already
 * COMPLETED or FAILED.
 */
export async function confirmYieldRedemption(yieldRedemptionRequestId: string): Promise<void> {
  const request = await prisma.yieldRedemptionRequest.findUnique({
    where: { id: yieldRedemptionRequestId },
    include: { yieldPosition: true },
  });

  if (!request) {
    console.error(`[confirmYieldRedemption] request ${yieldRedemptionRequestId} not found`);
    return;
  }
  if (request.status === "COMPLETED" || request.status === "FAILED") {
    return; // already resolved
  }
  if (!request.circleConversionId) {
    // Never got past submission — lib/savings/yield.ts#submitRedemptionToCircle
    // (or its manual retry, retryRedemptionSubmission) is responsible for
    // moving this out of PENDING. This job simply exits and will be
    // re-enqueued on its own backoff.
    throw new RedemptionStillPendingError("PENDING (not yet submitted to Circle)");
  }

  const status = await getUsycConversionStatus(request.circleConversionId);

  if (SUCCESS_STATES.has(status.state)) {
    await finalizeSuccessfulRedemption(request.id, status.settledAmount, status.navApplied);
    return;
  }

  if (FAILURE_STATES.has(status.state)) {
    await prisma.yieldRedemptionRequest.update({
      where: { id: request.id },
      data: { status: "FAILED", failureReason: `Circle reported ${status.state}` },
    });
    return;
  }

  // Still settling — not yet terminal.
  throw new RedemptionStillPendingError(status.state);
}

async function finalizeSuccessfulRedemption(
  requestId: string,
  settledAmountDecimal: string | undefined,
  navApplied: string | undefined
): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const request = await tx.yieldRedemptionRequest.findUnique({
      where: { id: requestId },
      include: { yieldPosition: true },
    });
    if (!request || request.status === "COMPLETED") return; // already handled (idempotency / redelivery)

    // Prefer Circle's reported settlement amount (the NAV-at-redemption
    // truth); fall back to our own estimate using navApplied (or the
    // position's navAtDeploy, worst case) only if Circle's response
    // omitted it — never invent a number silently different from what
    // actually settled.
    const usdcSettled = settledAmountDecimal
      ? toSmallestUnit(settledAmountDecimal)
      : usycToUsdc(request.usycAmountRequested, navApplied ?? request.yieldPosition.navAtDeploy);

    const entry = await recordEntry(
      {
        ledgerAccountId: request.ledgerAccountId,
        amount: usdcSettled,
        direction: "CREDIT",
        referenceType: "YIELD_REDEMPTION",
        referenceId: request.id,
      },
      tx
    );

    const remainingUsyc = request.yieldPosition.usycAmount - request.usycAmountRequested;
    const clampedRemaining = remainingUsyc < 0n ? 0n : remainingUsyc;

    await tx.yieldPosition.update({
      where: { id: request.yieldPositionId },
      data: {
        usycAmount: clampedRemaining,
        status: clampedRemaining === 0n ? "REDEEMED" : "ACTIVE",
        redeemedAt: clampedRemaining === 0n ? new Date() : null,
      },
    });

    await tx.yieldRedemptionRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        usdcAmountSettled: usdcSettled,
        ledgerEntryId: entry.id,
        settledAt: new Date(),
      },
    });
  });
}

// Only start the worker loop when this file is run directly (not when
// imported for its confirmYieldRedemption export, e.g. from a manual
// reconciliation script).
if (require.main === module) {
  const worker = new Worker<ConfirmYieldRedemptionJobData>(
    QUEUE_NAMES.YIELD_REDEMPTION_CONFIRMATION,
    async (job: Job<ConfirmYieldRedemptionJobData>) => {
      await confirmYieldRedemption(job.data.yieldRedemptionRequestId);
    },
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job) => {
    console.log(`[confirmYieldRedemption] resolved ${job.data.yieldRedemptionRequestId}`);
  });
  worker.on("failed", (job, err) => {
    if (err instanceof RedemptionStillPendingError) {
      console.log(`[confirmYieldRedemption] ${job?.data.yieldRedemptionRequestId} still pending, will retry`);
    } else {
      console.error(`[confirmYieldRedemption] job failed for ${job?.data.yieldRedemptionRequestId}`, err);
    }
  });

  console.log("[confirmYieldRedemption] worker started, listening for jobs...");
}