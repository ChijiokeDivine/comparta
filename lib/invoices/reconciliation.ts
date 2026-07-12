// lib/invoices/reconciliation.ts
//
// Auto-reconciles a confirmed inbound OnchainTransaction against the
// issuing org's open invoices, transitioning a match to PAID.
//
// Phase 4 note: once payment links exist, this should match by
// paymentLinkId embedded in the transfer (unambiguous by construction).
// Until then, this is a same-org + exact-amount heuristic — call sites
// (lib/transfers/receive.ts) invoke it for every confirmed inbound
// transfer, and it deliberately no-ops for the common case where a
// transfer isn't for any invoice at all (zero matches).
//
// v1 explicitly does NOT support partial payment. An inbound amount that
// doesn't exactly match exactly one open invoice's total is left alone —
// either it's an unrelated payment (zero matches, normal) or it's an
// overpayment/underpayment/ambiguous-duplicate-amount case (one or more
// candidates matched by nothing this simple, or too many matched)
// flagged for the issuer to sort out manually rather than silently
// guessed at.

import type { Prisma } from "@/app/generated/prisma/client";
import { flagPaymentForManualReconciliation, notifyIssuerInvoicePaid } from "@/lib/notifications/notify";

type Tx = Prisma.TransactionClient;

export interface ReconcileResult {
  matched: boolean;
  invoiceId?: string;
}

/**
 * Must be called from WITHIN the same DB transaction that creates/confirms
 * the OnchainTransaction row, so an invoice is never marked PAID off a
 * transfer whose own write later rolls back. Non-throwing: reconciliation
 * ambiguity is a business event (flagged for manual review), not an error
 * that should fail the inbound-transfer transaction.
 */
export async function reconcileInboundPaymentAgainstInvoices(
  tx: Tx,
  orgId: string,
  onchainTransactionId: string,
  amount: bigint
): Promise<ReconcileResult> {
  const candidates = await tx.invoice.findMany({
    where: {
      orgId,
      status: { in: ["SENT", "VIEWED", "OVERDUE"] },
      total: amount,
      currency: "USDC", // only USDC settles onchain today
    },
    select: { id: true },
  });

  if (candidates.length === 0) {
    return { matched: false }; // ordinary payment, not tied to any invoice — not an error
  }

  if (candidates.length > 1) {
    await flagPaymentForManualReconciliation(
      orgId,
      onchainTransactionId,
      `Inbound transfer of ${amount} matched ${candidates.length} open invoices with the same total — ` +
        `ambiguous, needs manual reconciliation: ${candidates.map((c) => c.id).join(", ")}`
    );
    return { matched: false };
  }

  const invoiceId = candidates[0]!.id;
  await markInvoicePaid(tx, invoiceId, onchainTransactionId);

  return { matched: true, invoiceId };
}

/**
 * Flips a specific, already-identified invoice to PAID. Extracted so
 * callers that already know the exact invoice — no amount-matching
 * heuristic needed — can reuse the same write path rather than
 * duplicating it. Used by reconcileInboundPaymentAgainstInvoices above
 * (heuristic match) and by lib/paymentLinks/completion.ts (unambiguous
 * match via a payment link's checkout session).
 */
export async function markInvoicePaid(
  tx: Tx,
  invoiceId: string,
  onchainTransactionId: string
): Promise<void> {
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID", paidTxId: onchainTransactionId, paidAt: new Date() },
  });
  await tx.invoiceEvent.create({
    data: { invoiceId, eventType: "PAID", metadata: { onchainTransactionId } as never },
  });
}

/** Fire-and-forget notification, called after the transaction that reconciled the invoice commits. */
export async function notifyInvoicePaidIfMatched(orgId: string, result: ReconcileResult): Promise<void> {
  if (result.matched && result.invoiceId) {
    await notifyIssuerInvoicePaid(orgId, result.invoiceId).catch((err) =>
      console.error(`[invoices] paid-notification failed for ${result.invoiceId}`, err)
    );
  }
}