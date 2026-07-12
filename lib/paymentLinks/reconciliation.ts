// lib/paymentLinks/reconciliation.ts
//
// Matches a confirmed inbound OnchainTransaction against open payment-link
// checkout sessions (PaymentLinkPayment rows with method=WALLET and
// status=PENDING). Called from lib/transfers/receive.ts for every inbound
// transfer, ahead of the legacy invoice exact-amount heuristic
// (lib/invoices/reconciliation.ts) — a payment-link match is more
// specific and, when clean, credits the LINK's chosen
// receivingLedgerAccountId rather than the org's default bucket.
//
// Matching key: (orgId, method=WALLET, status=PENDING, amountExpected).
// amountExpected is fixed at session-start (see lib/paymentLinks/checkout.ts),
// so this is exact-amount matching against a much smaller, self-selected
// candidate set than the invoice heuristic — but it is still a heuristic,
// not a true onchain reference/memo match (see the module-level note in
// lib/invoices/reconciliation.ts for why: plain EOA-to-EOA USDC transfers
// don't carry an application-level reference field). Concretely:
//
//   - exactly one PENDING session at this amount -> clean match, confirm it
//   - zero matches, but exactly one still-open PENDING session on a
//     FIXED_AMOUNT link -> likely the "payer sent the wrong amount" case;
//     policy is reject-and-refund (see issueWrongAmountRefund below)
//   - more than one PENDING session at this amount, or more than one
//     still-open FIXED_AMOUNT session when the wrong-amount case applies
//     -> genuinely ambiguous, flagged for manual review, funds land in
//     the org's default bucket via the normal receive.ts fallback rather
//     than being auto-refunded to the wrong payer
//   - no candidates at all -> not a payment-link payment; receive.ts falls
//     through to its existing default-credit + invoice-heuristic behavior

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { sendTransaction as circleSendTransaction, CircleApiError } from "@/lib/circle/wallets";
import { confirmPaymentLinkPayment } from "./completion";
import { flagPaymentForManualReconciliation } from "@/lib/notifications/notify";
import { getQueue, QUEUE_NAMES } from "@/jobs/queue";
import { randomUUID } from "node:crypto";

type Tx = Prisma.TransactionClient;

// How long a checkout session stays eligible for the "wrong amount, likely
// this session" inference. Long enough for a payer to fumble a wallet
// app's amount field; short enough that an abandoned session from hours
// ago never gets blamed for an unrelated transfer.
const WRONG_AMOUNT_WINDOW_MS = 30 * 60 * 1000;

export type PaymentLinkReconcileResult =
  | { kind: "matched"; paymentLinkId: string; invoiceId?: string; creditLedgerAccountId: string }
  | { kind: "wrong_amount_pending_refund"; paymentLinkPaymentId: string; refundToAddress: string }
  | { kind: "ambiguous" }
  | { kind: "no_match" };

/**
 * Must be called from WITHIN the same DB transaction that creates the
 * inbound OnchainTransaction row, mirroring
 * lib/invoices/reconciliation.ts#reconcileInboundPaymentAgainstInvoices.
 * On a clean match, this ALSO performs the ledger credit + session/link
 * update (via confirmPaymentLinkPayment) — callers must NOT separately
 * credit the default ledger account when this returns "matched".
 */
export async function reconcileWalletTransferAgainstPaymentLinks(
  tx: Tx,
  orgId: string,
  onchainTransactionId: string,
  counterpartyAddress: string,
  amount: bigint
): Promise<PaymentLinkReconcileResult> {
  const exactMatches = await tx.paymentLinkPayment.findMany({
    where: {
      status: "PENDING",
      method: "WALLET",
      amountExpected: amount,
      paymentLink: { orgId },
    },
    select: { id: true, paymentLinkId: true, paymentLink: { select: { receivingLedgerAccountId: true } } },
  });

  if (exactMatches.length === 1) {
    const match = exactMatches[0]!;
    const result = await confirmPaymentLinkPayment(tx, {
      paymentLinkPaymentId: match.id,
      onchainTransactionId,
      amountPaid: amount,
      payerIdentifier: counterpartyAddress,
    });
    return {
      kind: "matched",
      paymentLinkId: result.paymentLinkId,
      invoiceId: result.invoiceId,
      creditLedgerAccountId: match.paymentLink.receivingLedgerAccountId,
    };
  }

  if (exactMatches.length > 1) {
    await flagPaymentForManualReconciliation(
      orgId,
      onchainTransactionId,
      `Inbound wallet transfer of ${amount} matched ${exactMatches.length} open payment-link checkout ` +
        `sessions with the same expected amount — ambiguous: ${exactMatches.map((m) => m.id).join(", ")}`
    );
    return { kind: "ambiguous" };
  }

  // Zero exact matches: check for the "wrong amount on a fixed-amount
  // link" case before giving up entirely.
  const openFixedAmountSessions = await tx.paymentLinkPayment.findMany({
    where: {
      status: "PENDING",
      method: "WALLET",
      createdAt: { gte: new Date(Date.now() - WRONG_AMOUNT_WINDOW_MS) },
      paymentLink: { orgId, type: "FIXED_AMOUNT" },
    },
    select: { id: true },
  });

  if (openFixedAmountSessions.length === 1) {
    const session = openFixedAmountSessions[0]!;
    // Funds are real and already at this org's custody address — credit
    // the default flow will handle the ledger side (receive.ts credits
    // the org's default bucket for ANY non-matched inbound transfer,
    // which is correct here too: the money is sitting in the wallet and
    // must be reflected somewhere until the refund clears). Mark the
    // session itself so it stops being a live candidate and so the
    // merchant's usage list shows what happened.
    await tx.paymentLinkPayment.update({
      where: { id: session.id },
      data: {
        status: "WRONG_AMOUNT_REFUNDED",
        amountPaid: amount,
        txId: onchainTransactionId,
        payerIdentifier: counterpartyAddress,
        confirmedAt: new Date(),
        failureReason: `Received ${amount} but this checkout session expected a different fixed amount — rejected and queued for refund.`,
      },
    });
    return { kind: "wrong_amount_pending_refund", paymentLinkPaymentId: session.id, refundToAddress: counterpartyAddress };
  }

  if (openFixedAmountSessions.length > 1) {
    await flagPaymentForManualReconciliation(
      orgId,
      onchainTransactionId,
      `Inbound wallet transfer of ${amount} didn't match any open checkout session's expected amount, and ` +
        `${openFixedAmountSessions.length} fixed-amount sessions are open concurrently — can't tell which one ` +
        `it was meant for. Left for manual review.`
    );
    return { kind: "ambiguous" };
  }

  return { kind: "no_match" };
}

/**
 * Submits the actual refund transaction for a WRONG_AMOUNT_REFUNDED
 * session. Called AFTER the transaction that recorded the inbound
 * transfer + WRONG_AMOUNT_REFUNDED status has committed — mirrors
 * lib/transfers/send.ts's posture of submitting to Circle outside the DB
 * transaction that established the funds are there to send. Debits the
 * org's default ledger bucket (where the wrong-amount funds were credited
 * by receive.ts's fallback path) for the refunded amount once the refund
 * is submitted.
 */
export async function issueWrongAmountRefund(
  orgId: string,
  paymentLinkPaymentId: string
): Promise<void> {
  const session = await prisma.paymentLinkPayment.findUnique({
    where: { id: paymentLinkPaymentId },
    include: { paymentLink: { include: { organization: { include: { wallets: { take: 1 } } } } } },
  });
  if (!session || session.status !== "WRONG_AMOUNT_REFUNDED" || !session.amountPaid || !session.payerIdentifier) {
    console.error(
      `[paymentLinks] issueWrongAmountRefund called on session ${paymentLinkPaymentId} in an unexpected state — skipping.`
    );
    return;
  }

  const wallet = session.paymentLink.organization.wallets[0];
  if (!wallet) {
    console.error(`[paymentLinks] Org ${orgId} has no wallet — cannot refund session ${paymentLinkPaymentId}.`);
    return;
  }

  const defaultLedgerAccountId = await resolveDefaultLedgerAccountId(orgId, wallet.id);
  if (!defaultLedgerAccountId) {
    console.error(
      `[paymentLinks] Org ${orgId} has no default ledger account — cannot refund session ${paymentLinkPaymentId}.`
    );
    return;
  }

  const idempotencyKey = `refund-wrong-amount-${paymentLinkPaymentId}`;

  let circleResult: Awaited<ReturnType<typeof circleSendTransaction>>;
  try {
    circleResult = await circleSendTransaction(
      wallet.circleWalletId,
      session.payerIdentifier,
      session.amountPaid,
      idempotencyKey
    );
  } catch (err) {
    console.error(
      `[paymentLinks] CRITICAL: failed to submit wrong-amount refund for session ${paymentLinkPaymentId} ` +
        `(org ${orgId}, amount ${session.amountPaid}). Needs manual refund.`,
      err instanceof CircleApiError ? err.cause ?? err : err
    );
    return;
  }

  try {
    await prisma.$transaction(async (tx: Tx) => {
      const refundTx = await tx.onchainTransaction.create({
        data: {
          walletId: wallet.id,
          direction: "OUT",
          amount: session.amountPaid!,
          counterpartyAddress: session.payerIdentifier!,
          chain: wallet.chain,
          sourceChain: wallet.chain,
          status: "PENDING",
          referenceType: "ADJUSTMENT",
          referenceId: paymentLinkPaymentId,
          memo: `Refund: wrong amount sent to payment link checkout session ${paymentLinkPaymentId}`,
          idempotencyKey,
          circleTransactionId: circleResult.circleTransactionId,
        },
      });

      await recordEntry(
        {
          ledgerAccountId: defaultLedgerAccountId,
          amount: session.amountPaid!,
          direction: "DEBIT",
          referenceType: "ONCHAIN_TX",
          referenceId: refundTx.id,
        },
        tx
      );

      return refundTx;
    });

    await enqueueConfirmationPolling(idempotencyKey, circleResult.circleTransactionId);
  } catch (err) {
    console.error(
      `[paymentLinks] CRITICAL: refund for session ${paymentLinkPaymentId} was submitted to Circle ` +
        `(circleTransactionId=${circleResult.circleTransactionId}) but the local DB write failed. ` +
        `Manual reconciliation needed.`,
      err
    );
  }
}

async function resolveDefaultLedgerAccountId(orgId: string, walletId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { defaultLedgerAccountId: true },
  });
  if (org?.defaultLedgerAccountId) return org.defaultLedgerAccountId;

  const operating = await prisma.ledgerAccount.findFirst({
    where: { orgId, walletId, name: "Operating" },
    select: { id: true },
  });
  return operating?.id ?? null;
}

async function enqueueConfirmationPolling(label: string, onchainTransactionRefKey: string): Promise<void> {
  try {
    const queue = getQueue(QUEUE_NAMES.CONFIRM_TRANSACTION);
    // The confirmTransaction job keys off our local OnchainTransaction id,
    // not Circle's — look it up by the idempotency key we just wrote.
    const tx = await prisma.onchainTransaction.findUnique({
      where: { idempotencyKey: label },
      select: { id: true },
    });
    if (!tx) return;
    await queue.add(
      "confirm",
      { onchainTransactionId: tx.id },
      { attempts: 20, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true, removeOnFail: false, jobId: `${randomUUID()}-${onchainTransactionRefKey}` }
    );
  } catch (err) {
    console.error(`[paymentLinks] Failed to enqueue refund confirmation polling for ${label}`, err);
  }
}