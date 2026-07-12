// lib/transfers/receive.ts
//
// Handles Circle's `transactions.inbound` webhook notifications: an
// external payer (possibly on a different chain entirely, consolidated
// via CCTP/Gateway into a unified USDC balance on Arc) sent funds to one
// of our orgs' wallets. This module resolves which org owns that wallet,
// credits its default LedgerAccount, and records the OnchainTransaction —
// mirroring the debit side in lib/transfers/send.ts but for the inbound
// direction.
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

  const defaultLedgerAccountId = await resolveDefaultLedgerAccountId(wallet.orgId, wallet.id);
  if (!defaultLedgerAccountId) {
    throw new ReceiveHandlingError(
      `Org ${wallet.orgId} has no default ledger account configured — cannot credit inbound transfer ${notification.circleTransactionId}.`
    );
  }

  const settlementChain: Chain = mapCircleBlockchain(notification.blockchain) ?? wallet.chain;
  const sourceChain: Chain =
    mapCircleBlockchain(notification.sourceBlockchain ?? notification.blockchain) ?? settlementChain;

  const reconciliation = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const onchainTx = await tx.onchainTransaction.create({
      data: {
        walletId: wallet.id,
        direction: "IN",
        amount,
        counterpartyAddress: notification.sourceAddress ?? "unknown",
        chain: settlementChain,
        sourceChain,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        txHash: notification.txHash,
        circleTransactionId: notification.circleTransactionId,
        rawPayload: notification.rawPayload as never,
      },
    });

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

    // Invoice auto-reconciliation happens in the SAME transaction as the
    // ledger credit: an invoice must never flip to PAID off a transfer
    // whose own write later rolls back. This is the interim stand-in for
    // Phase 4 payment-link matching — see lib/invoices/reconciliation.ts.
    return reconcileInboundPaymentAgainstInvoices(tx, wallet.orgId, onchainTx.id, amount);
  });

  await notifyPaymentReceived(wallet.orgId, amount);
  await notifyInvoicePaidIfMatched(wallet.orgId, reconciliation);
}

/**
 * Resolves which LedgerAccount inbound funds should land in:
 * Organization.defaultLedgerAccountId if set, otherwise falls back to the
 * org's "Operating" bucket by name (the convention established at KYB
 * approval, see app/api/org/kyb/approve/route.ts).
 */
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

/** Placeholder notification hook — wire up to real email/in-app notifications once that infra exists. */
async function notifyPaymentReceived(orgId: string, amount: bigint): Promise<void> {
  console.log(`[notify] Inbound payment received for org ${orgId}, amount=${amount}`);
}