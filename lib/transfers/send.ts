// lib/transfers/send.ts
//
// The generic outbound transfer primitive. Every feature that moves money
// out of an org's wallet — a manual send, an invoice payout, a payroll
// run, a DCA execution — calls sendPayment() rather than talking to the
// ledger engine or Circle directly. Keeping this in one place means
// balance-checking, idempotency, and the debit-then-poll-then-reconcile
// flow only need to be correct once.
//
// Flow:
//   1. resolve toIdentifier -> destination address (lib/identity/resolver)
//   2. reject sending to yourself
//   3. validate amount (positive, <=6 decimals — reject, never silently round)
//   4. check fromLedgerAccountId has sufficient balance (fast-fail; the
//      real atomic guard is still recordEntry's row lock in step 6)
//   5. submit the transfer to Circle (idempotency key protects against
//      double-submission even if this function is retried)
//   6. in a single DB transaction: write the OnchainTransaction (PENDING)
//      row and debit the ledger account via recordEntry — the ledger
//      debits immediately, not on confirmation; Arc's sub-second finality
//      keeps the unconfirmed-but-debited window tiny, and the confirmation
//      poller reverses it if the transfer ultimately fails
//   7. enqueue confirmation polling
//
// If step 6 fails after step 5 succeeded (funds left Circle but our DB
// write didn't land), that's logged as CRITICAL for manual reconciliation
// against Circle's own transaction records — the same partial-failure
// pattern used in the KYB-approval wallet provisioning flow.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { recordEntry, getBalance, InsufficientBalanceError as LedgerInsufficientBalanceError } from "@/lib/ledger/engine";
import { sendTransaction as circleSendTransaction, CircleApiError } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { touchContactLastPaid } from "@/lib/contacts/service";
import { getQueue, QUEUE_NAMES } from "@/jobs/queue";
import type { LedgerReferenceType, Prisma } from "@/app/generated/prisma/client";

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
  status: "PENDING";
  amount: string; // decimal string
  toAddress: string;
  toOrgId?: string;
  toDisplayName?: string;
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  // 1. Resolve recipient. Resolver failures get a specific, user-facing
  // message rather than a generic "something went wrong" — the person
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

  // 2. Reject self-send — comparing resolved org, not raw identifier
  // string, so this also catches "send to my own address" and "send to
  // my own username" cases the same way.
  if (resolved.orgId && resolved.orgId === input.orgId) {
    throw new SendPaymentError("You can't send a payment to yourself.", "SELF_SEND");
  }

  // 3. Validate amount: positive, at most 6 decimal places. Reject
  // outright rather than rounding — silently truncating a user-entered
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
  // shouldn't reach end users — wrap it in a generic message instead.
  let circleResult: Awaited<ReturnType<typeof circleSendTransaction>>;
  try {
    circleResult = await circleSendTransaction(
      ledgerAccount.wallet.circleWalletId,
      resolved.address,
      amountSmallestUnit,
      idempotencyKey
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
  // transaction fails, funds have left custody without a local record —
  // that's the partial-failure case the edge cases call out explicitly.
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
          status: "PENDING",
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

    // 7. Enqueue confirmation polling — best-effort; a missed enqueue
    // here doesn't lose money (the transaction still exists in PENDING
    // and a periodic sweep can pick it up), so failures here are logged,
    // not thrown.
    await enqueueConfirmationPolling(onchainTx.id);

    // Best-effort address-book denormalization — never block the send on this.
    touchContactLastPaid(input.orgId, input.toIdentifier.trim()).catch(() => {});

    return {
      onchainTransactionId: onchainTx.id,
      circleTransactionId: circleResult.circleTransactionId,
      status: "PENDING",
      amount: toDecimalString(amountSmallestUnit),
      toAddress: resolved.address,
      toOrgId: resolved.orgId,
      toDisplayName: resolved.displayName,
    };
  } catch (err) {
    if (err instanceof LedgerInsufficientBalanceError) {
      // Lost the race between the fast-fail check and the atomic debit —
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
      "This payment may have been submitted but we couldn't confirm it locally. Our team has been notified — please don't retry until you hear back.",
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