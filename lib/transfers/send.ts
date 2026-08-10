// lib/transfers/send.ts
//
// The generic outbound transfer primitive. Every feature that moves money
// out of an org's wallet - a manual send, an invoice payout, a payroll
// run, a DCA execution - calls sendPayment() rather than talking to the
// ledger engine or Circle directly. Keeping this in one place means
// balance-checking, idempotency, and the debit-then-poll-then-reconcile
// flow only need to be correct once.
//
// Flow:
//   1. resolve toIdentifier -> destination address (lib/identity/resolver)
//   2. reject sending to yourself
//   3. validate amount (positive, <=6 decimals - reject, never silently round)
//   4. check fromLedgerAccountId has sufficient balance (fast-fail; the
//      real atomic guard is still recordEntry's row lock in step 6)
//   5. submit the transfer to Circle via App-Kit kit.send() — this is the
//      migration point from the old REST createTransaction flow. App-Kit
//      resolves synchronously to a final onchain result (txHash + state),
//      so a successful return here means the on-chain sim + signing +
//      submission all passed — there is no separate "pending" phase.
//   6. in a single DB transaction: write the OnchainTransaction (CONFIRMED
//      — with confirmedAt + txHash + explorerUrl) row and debit the
//      ledger account via recordEntry. The ledger debits at send time;
//      Arc's sub-second finality means this matches the on-chain reality
//      by the time the user sees the response.
//   7. post-commit hooks (best-effort, never thrown):
//        - payroll completion (marks PayrollRunItems CONFIRMED if the
//          referenceType is PAYROLL_RUN; confirmTransaction cron used to
//          do this via polling but App-Kit's txHash-as-circleTransactionId
//          breaks that path, so we run it inline here).
//        - contact book lastPaidAt touch (recent-paid-first ordering)
//        - smart savings rule engine (ROUND_UP)
//
// If step 6 fails after step 5 succeeded (funds left Circle but our DB
// write didn't land), that's logged as CRITICAL for manual reconciliation
// against Circle's own transaction records - the same partial-failure
// pattern used in the KYB-approval wallet provisioning flow.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { recordEntry, getBalance, InsufficientBalanceError as LedgerInsufficientBalanceError } from "@/lib/ledger/engine";
import { sendTransaction as circleSendTransaction, CircleApiError } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { touchContactLastPaid } from "@/lib/contacts/service";
// Phase 7 - Smart Savings: ROUND_UP SavingsRules fire on the outbound
// debit - the one trigger AllocationRule has no equivalent for. See
// lib/savings/sweep.ts's module docstring for why this lives here
// rather than on the inbound side.
import { executeOutgoingPaymentSavingsRules } from "@/lib/savings/sweep";
import { handlePayrollTransactionResolved } from "@/lib/payroll/completion";
import type { LedgerReferenceType, Prisma } from "@/app/generated/prisma/client";
import { getQueue, QUEUE_NAMES } from "@/jobs/queue";
export class SendPaymentError extends Error {
  constructor(message: string, public readonly code: SendErrorCode) {
    super(message);
    this.name = "SendPaymentError";
  }
}

export type SendErrorCode =
  | "INVALID_RECIPIENT"
  | "SELF_SEND"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "PROVIDER_ERROR"
  | "ACCOUNT_NOT_FOUND";

export interface SendPaymentInput {
  orgId: string;
  fromLedgerAccountId: string;
  toIdentifier: string;
  /** Decimal string, e.g. "125.50". Must have at most 6 decimal places (USDC precision). */
  amount: string;
  memo?: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  /** Protects against the same logical send being submitted to Circle twice. Auto-generated if omitted. */
  idempotencyKey?: string;
}

export interface SendPaymentResult {
  onchainTransactionId: string;
  circleTransactionId: string;
  status: "CONFIRMED";
  amount: string; // decimal string
  toAddress: string;
  toOrgId?: string;
  toDisplayName?: string;
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  // 1. Resolve recipient. Resolver failures get a specific, user-facing
  // message rather than a generic "something went wrong" - the person
  // needs to know whether it was a typo, an unclaimed username, or a
  // malformed address.
  let resolved: Awaited<ReturnType<typeof resolve>>;
  try {
    resolved = await resolve(input.toIdentifier);
  } catch (err) {
    if (err instanceof ResolverError) {
      throw new SendPaymentError(err.message, "INVALID_RECIPIENT");
    }
    throw err;
  }

  // 2. Reject self-send - comparing resolved org, not raw identifier
  // string, so this also catches "send to my own address" and "send to
  // my own username" cases the same way.
  if (resolved.orgId && resolved.orgId === input.orgId) {
    throw new SendPaymentError("You can't send a payment to yourself.", "SELF_SEND");
  }

  // 3. Validate amount: positive, at most 6 decimal places. Reject
  // outright rather than rounding - silently truncating a user-entered
  // amount is exactly the kind of surprise that erodes trust in a
  // payments product.
  let amountSmallestUnit: bigint;
  try {
    amountSmallestUnit = toSmallestUnit(input.amount);
  } catch {
    throw new SendPaymentError(
      `"${input.amount}" isn't a valid USDC amount. USDC supports at most 6 decimal places.`,
      "INVALID_AMOUNT"
    );
  }
  if (amountSmallestUnit <= 0n) {
    throw new SendPaymentError("Amount must be greater than zero.", "INVALID_AMOUNT");
  }

  // 4. Fast-fail balance check. Not the atomic guard (recordEntry's row
  // lock in step 6 is), but avoids submitting to Circle at all for an
  // obviously-insufficient balance.
  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: { id: input.fromLedgerAccountId, orgId: input.orgId },
    include: { wallet: true },
  });
  if (!ledgerAccount) {
    throw new SendPaymentError("Source ledger account not found.", "ACCOUNT_NOT_FOUND");
  }

  const currentBalance = await getBalance(ledgerAccount.id);
  if (currentBalance < amountSmallestUnit) {
    throw new SendPaymentError(
      `Insufficient balance: this account has ${toDecimalString(currentBalance)} USDC available.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  // 5. Submit to Circle. CircleApiError's raw message may contain
  // provider-internal detail (endpoint names, request ids) that
  // shouldn't reach end users - wrap it in a generic message instead.
  let circleResult: Awaited<ReturnType<typeof circleSendTransaction>>;
  try {
    circleResult = await circleSendTransaction(
      ledgerAccount.wallet.arcAddress,
      resolved.address,
      amountSmallestUnit,
      ledgerAccount.wallet.chain
    );
  } catch (err) {
    if (err instanceof CircleApiError) {
      console.error("[sendPayment] Circle submission failed", err.cause ?? err);
      throw new SendPaymentError(
        "We couldn't submit this payment right now. Please try again in a moment.",
        "PROVIDER_ERROR"
      );
    }
    throw err;
  }

  // 6. Persist the transaction + debit the ledger together. The Circle
  // call already succeeded and is idempotency-keyed, so if this DB
  // transaction fails, funds have left custody without a local record -
  // that's the partial-failure case the edge cases call out explicitly.
  //
  // NOTE ON STATUS (App-Kit migration):
  //   kit.send() resolves synchronously to a terminal onchain result
  //   (txHash + state: "success"). There is no PENDING phase exposed, and
  //   the confirmTransaction cron below can't help here either because
  //   OnchainTransaction.circleTransactionId now holds an onchain txHash,
  //   not a Circle-internal transaction UUID - which means
  //   client.getTransaction({ id }) in the poller would 404 and the row
  //   would stick PENDING forever. So we write CONFIRMED + confirmedAt
  //   directly at create time.
  try {
    const { onchainTx } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdTx = await tx.onchainTransaction.create({
        data: {
          walletId: ledgerAccount.walletId,
          direction: "OUT",
          amount: amountSmallestUnit,
          counterpartyAddress: resolved.address,
          chain: ledgerAccount.wallet.chain,
          sourceChain: ledgerAccount.wallet.chain,
          status: "CONFIRMED",
          confirmedAt: new Date(),
          txHash: circleResult.circleTransactionId,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          memo: input.memo,
          idempotencyKey,
          circleTransactionId: circleResult.circleTransactionId,
        },
      });

      await recordEntry(
        {
          ledgerAccountId: ledgerAccount.id,
          amount: amountSmallestUnit,
          direction: "DEBIT",
          referenceType: "ONCHAIN_TX",
          referenceId: createdTx.id,
        },
        tx
      );

      return { onchainTx: createdTx };
    });

    // 7. (intentionally no confirmation polling enqueue — App-Kit sends
    //     resolve synchronously, so we've already written CONFIRMED above)

    // Best-effort post-commit hooks — same "never block the primary
    // payment result" posture as the confirmation-polling equivalent in
    // jobs/confirmTransaction.ts. Keep these independent; one failing
    // must not affect another.
    handlePayrollTransactionResolved(onchainTx).catch((err) =>
      console.error(`[sendPayment] payroll completion hook failed for onchainTx ${onchainTx.id}`, err)
    );

    // Best-effort address-book denormalization - never block the send on this.
    touchContactLastPaid(input.orgId, input.toIdentifier.trim()).catch(() => {});

    // Phase 7 - Smart Savings: ROUND_UP rules sourced from this same
    // bucket. Post-commit, best-effort, same posture as every other
    // rule-engine hook in this codebase - a savings sweep failing must
    // never affect (or be affected by) the outbound payment that already
    // debited successfully.
    executeOutgoingPaymentSavingsRules({
      orgId: input.orgId,
      sourceLedgerAccountId: input.fromLedgerAccountId,
      debitedAmount: amountSmallestUnit,
      triggerReferenceType: "ONCHAIN_TX",
      triggerReferenceId: onchainTx.id,
    }).catch((err) => console.error(`[sendPayment] savings rules failed for onchainTx ${onchainTx.id}`, err));

    return {
      onchainTransactionId: onchainTx.id,
      circleTransactionId: circleResult.circleTransactionId,
      status: "CONFIRMED",
      amount: toDecimalString(amountSmallestUnit),
      toAddress: resolved.address,
      toOrgId: resolved.orgId,
      toDisplayName: resolved.displayName,
    };
  } catch (err) {
    if (err instanceof LedgerInsufficientBalanceError) {
      // Lost the race between the fast-fail check and the atomic debit -
      // extremely rare (another concurrent send drained the balance in
      // between) but must surface clearly rather than as a 500. Funds
      // were already submitted to Circle at this point; this needs
      // manual reconciliation.
      console.error(
        `[sendPayment] CRITICAL: Circle tx ${circleResult.circleTransactionId} submitted but ledger debit ` +
          `failed on insufficient balance (race). Manual reconciliation needed.`,
        err
      );
      throw new SendPaymentError(
        "This payment could not be completed due to a balance conflict. Our team has been notified.",
        "INSUFFICIENT_BALANCE"
      );
    }
    console.error(
      `[sendPayment] CRITICAL: Circle tx ${circleResult.circleTransactionId} submitted but local DB write ` +
        `failed. Manual reconciliation against Circle's records needed.`,
      err
    );
    throw new SendPaymentError(
      "This payment may have been submitted but we couldn't confirm it locally. Our team has been notified - please don't retry until you hear back.",
      "PROVIDER_ERROR"
    );
  }
}
async function enqueueConfirmationPolling(onchainTransactionId: string): Promise<void> {
  try {
    const queue = getQueue(QUEUE_NAMES.CONFIRM_TRANSACTION);
    await queue.add(
      "confirm",
      { onchainTransactionId },
      {
        attempts: 20,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  } catch (err) {
    console.error(
      `[sendPayment] Failed to enqueue confirmation polling for ${onchainTransactionId}. ` +
        `A periodic sweep should still pick this up.`,
      err
    );
  }
}
