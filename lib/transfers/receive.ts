// lib/transfers/receive.ts
//
// Handles Circle's `transactions.inbound` webhook notifications: an
// external payer (possibly on a different chain entirely, consolidated
// via CCTP/Gateway into a unified USDC balance on Arc) sent funds to one
// of our orgs' wallets. This module resolves which org owns that wallet
// and records the OnchainTransaction, then decides where the credit goes:
//
//   1. lib/paymentLinks/reconciliation.ts first — if this transfer cleanly
//      matches an open payment-link checkout session, it credits that
//      link's chosen receivingLedgerAccountId (not necessarily the org's
//      default bucket) and, if the link is invoice-attached, flips that
//      invoice to PAID. See that module for the wrong-amount /
//      ambiguous-match policy.
//   2. Otherwise, falls back to the pre-Phase-4 behavior: credit the org's
//      default LedgerAccount and run the legacy exact-amount invoice
//      heuristic (lib/invoices/reconciliation.ts) — this is what still
//      handles a plain send-to-username transfer or an invoice paid via
//      its direct-address fallback (no payment link).
//
// Idempotency: Circle may redeliver the same webhook (at-least-once
// delivery). Every write here is keyed off circleTransactionId
// (notification.id), so a redelivered event is a no-op on the second
// pass rather than double-crediting the ledger.

import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { toSmallestUnit } from "@/lib/circle/amount";
import { mapCircleBlockchain } from "@/lib/circle/chainMapping";
import { reconcileInboundPaymentAgainstInvoices, notifyInvoicePaidIfMatched } from "@/lib/invoices/reconciliation";
import { reconcileWalletTransferAgainstPaymentLinks, issueWrongAmountRefund } from "@/lib/paymentLinks/reconciliation";
import { executeIncomingPaymentAllocationRules } from "@/lib/allocationRules/engine";
// Phase 7 — Smart Savings: PERCENTAGE_OF_INCOME SavingsRules fire on the
// exact same trigger point as ON_INCOMING_PAYMENT AllocationRules, for
// the same reason (see lib/savings/sweep.ts's module docstring).
import { executeIncomingPaymentSavingsRules } from "@/lib/savings/sweep";
import type { Chain, Prisma } from "@/app/generated/prisma/client";

export interface InboundNotification {
  /** Circle's notification.id — the transaction identifier, used as our idempotency key. */
  circleTransactionId: string;
  /** Circle's notification.walletId — which of our Circle wallets received funds. */
  walletId: string;
  /** Settlement blockchain, per Circle's `blockchain` field — expected to be Arc. */
  blockchain: string;
  /**
   * Origin chain, when Circle's payload distinguishes it from the
   * settlement chain (e.g. a CCTP/Gateway-consolidated inbound transfer).
   * Falls back to `blockchain` when absent — most inbound notifications
   * don't carry a separate source-chain field, meaning the transfer
   * originated and settled on the same chain.
   */
  tokenId?: string;
  sourceBlockchain?: string;
  destinationAddress: string;
  sourceAddress?: string;
  amounts: string[];
  state: string;
  txHash?: string;
  rawPayload: unknown;
}

const INBOUND_TERMINAL_SUCCESS_STATES = new Set(["COMPLETE", "COMPLETED", "CONFIRMED"]);

export class ReceiveHandlingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiveHandlingError";
  }
}

/**
 * Processes one inbound notification. Returns without error (and without
 * side effects) for non-terminal states — those will arrive again as a
 * later webhook once Circle considers the transfer final.
 */
export async function handleInboundTransfer(notification: InboundNotification): Promise<void> {
  if (!INBOUND_TERMINAL_SUCCESS_STATES.has(notification.state.toUpperCase())) {
    return; // not yet final; ignore until Circle reports a terminal state
  }

  // Idempotency: if we've already recorded this Circle transaction, this
  // is a redelivered webhook — no-op.
  const existing = await prisma.onchainTransaction.findUnique({
    where: { circleTransactionId: notification.circleTransactionId },
  });
  if (existing) return;

  const wallet = await prisma.wallet.findUnique({
    where: { circleWalletId: notification.walletId },
    include: { organization: true },
  });
  if (!wallet) {
    // Not one of ours (or ours but not yet synced locally) — nothing to
    // credit. Logged rather than thrown so an unrelated/foreign webhook
    // doesn't fail the whole delivery.
    console.warn(
      `[receive] Inbound transfer to unknown Circle wallet ${notification.walletId} — ignoring.`
    );
    return;
  }

  const amountRaw = notification.amounts[0];
  if (!amountRaw) {
    throw new ReceiveHandlingError(
      `Inbound notification ${notification.circleTransactionId} has no amount.`
    );
  }
  const amount = toSmallestUnit(amountRaw);
  const counterpartyAddress = notification.sourceAddress ?? "unknown";

  const settlementChain: Chain = mapCircleBlockchain(notification.blockchain) ?? wallet.chain;
  const sourceChain: Chain =
    mapCircleBlockchain(notification.sourceBlockchain ?? notification.blockchain) ?? settlementChain;

  const { reconciliation, paymentLinkResult, onchainTxId, allocationSource } = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const onchainTx = await tx.onchainTransaction.create({
        data: {
          walletId: wallet.id,
          direction: "IN",
          amount,
          counterpartyAddress,
          chain: settlementChain,
          sourceChain,
          status: "CONFIRMED",
          confirmedAt: new Date(),
          txHash: notification.txHash,
          circleTransactionId: notification.circleTransactionId,
          rawPayload: notification.rawPayload as never,
        },
      });

      // Payment-link matching happens first — a clean match credits the
      // link's own receivingLedgerAccountId and handles the whole
      // credit/status-update itself. Anything else (no match, ambiguous,
      // or wrong-amount) falls through to the pre-Phase-4 default-bucket
      // behavior below.
      const linkResult = await reconcileWalletTransferAgainstPaymentLinks(
        tx,
        wallet.orgId,
        onchainTx.id,
        counterpartyAddress,
        amount
      );

      if (linkResult.kind === "matched") {
        // The ledger credit + (if applicable) invoice PAID transition
        // already happened inside reconcileWalletTransferAgainstPaymentLinks
        // via confirmPaymentLinkPayment — reuse the same
        // notifyInvoicePaidIfMatched call below for the notification,
        // shaped as a ReconcileResult so that one notification path
        // covers both the legacy heuristic and the payment-link match.
        return {
          reconciliation: { matched: Boolean(linkResult.invoiceId), invoiceId: linkResult.invoiceId },
          paymentLinkResult: linkResult,
          onchainTxId: onchainTx.id,
          // Payment-link credits go to the link's own receivingLedgerAccountId,
          // not the org's default bucket — allocation rules are scoped to the
          // default-bucket path today (see module docstring above and
          // lib/allocationRules/engine.ts). A future phase wanting rules to
          // also apply here would set this instead of null.
          allocationSource: null as { orgId: string; ledgerAccountId: string } | null,
        };
      }

      // No clean payment-link match (or the wrong-amount case, which still
      // needs the funds reflected in the default bucket until the refund
      // clears) — credit the org's default ledger account, same as before
      // Phase 4 existed.
      const defaultLedgerAccountId = await resolveDefaultLedgerAccountId(tx, wallet.orgId, wallet.id);
      if (!defaultLedgerAccountId) {
        throw new ReceiveHandlingError(
          `Org ${wallet.orgId} has no default ledger account configured — cannot credit inbound transfer ${notification.circleTransactionId}.`
        );
      }

      await recordEntry(
        {
          ledgerAccountId: defaultLedgerAccountId,
          amount,
          direction: "CREDIT",
          referenceType: "ONCHAIN_TX",
          referenceId: onchainTx.id,
        },
        tx
      );

      // Legacy direct-address invoice matching — only meaningful for
      // invoices that never got a payment link (or predate Phase 4).
      const invoiceReconciliation = await reconcileInboundPaymentAgainstInvoices(
        tx,
        wallet.orgId,
        onchainTx.id,
        amount
      );

      return {
        reconciliation: invoiceReconciliation,
        paymentLinkResult: linkResult,
        onchainTxId: onchainTx.id,
        allocationSource: { orgId: wallet.orgId, ledgerAccountId: defaultLedgerAccountId },
      };
    }
  );

  await notifyPaymentReceived(wallet.orgId, amount);
  await notifyInvoicePaidIfMatched(wallet.orgId, reconciliation);

  // Auto-allocation rules (e.g. "move 20% of every incoming payment to Tax
  // Reserve") run AFTER the credit transaction above has committed — see
  // lib/allocationRules/engine.ts's docstring for why this can't be nested
  // inside that transaction. A rule failing (e.g. a misconfigured
  // FIXED_AMOUNT rule that can't be covered) is logged and never affects
  // the inbound payment that was already durably credited.
  if (allocationSource) {
    await executeIncomingPaymentAllocationRules({
      orgId: allocationSource.orgId,
      sourceLedgerAccountId: allocationSource.ledgerAccountId,
      creditedAmount: amount,
      triggerReferenceType: "ONCHAIN_TX",
      triggerReferenceId: onchainTxId,
    }).catch((err) => console.error(`[receive] allocation rules failed for onchainTx ${onchainTxId}`, err));

    // Phase 7 — Smart Savings: PERCENTAGE_OF_INCOME rules sourced from
    // this same bucket. Independent of (and never blocking) allocation
    // rules — a savings sweep failing must never affect an allocation
    // rule that also fired off this payment, and vice versa.
    await executeIncomingPaymentSavingsRules({
      orgId: allocationSource.orgId,
      sourceLedgerAccountId: allocationSource.ledgerAccountId,
      creditedAmount: amount,
      triggerReferenceType: "ONCHAIN_TX",
      triggerReferenceId: onchainTxId,
    }).catch((err) => console.error(`[receive] savings rules failed for onchainTx ${onchainTxId}`, err));
  }

  if (paymentLinkResult.kind === "wrong_amount_pending_refund") {
    // Submitted outside the transaction that recorded the inbound
    // transfer, mirroring lib/transfers/send.ts's posture — Circle calls
    // never belong inside a DB transaction.
    await issueWrongAmountRefund(wallet.orgId, paymentLinkResult.paymentLinkPaymentId).catch((err) =>
      console.error(`[receive] wrong-amount refund failed for onchainTx ${onchainTxId}`, err)
    );
  }
}

/**
 * Resolves which LedgerAccount inbound funds should land in when there's
 * no payment-link match: Organization.defaultLedgerAccountId if set,
 * otherwise falls back to the org's "Operating" bucket by name (the
 * convention established at KYB approval, see
 * app/api/org/kyb/approve/route.ts).
 */
async function resolveDefaultLedgerAccountId(
  tx: Prisma.TransactionClient,
  orgId: string,
  walletId: string
): Promise<string | null> {
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { defaultLedgerAccountId: true },
  });
  if (org?.defaultLedgerAccountId) return org.defaultLedgerAccountId;

  const operating = await tx.ledgerAccount.findFirst({
    where: { orgId, walletId, name: "Operating" },
    select: { id: true },
  });
  return operating?.id ?? null;
}

/** Placeholder notification hook — wire up to real email/in-app notifications once that infra exists. */
async function notifyPaymentReceived(orgId: string, amount: bigint): Promise<void> {
  console.log(`[notify] Inbound payment received for org ${orgId}, amount=${amount}`);
}