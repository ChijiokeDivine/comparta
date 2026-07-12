// lib/paymentLinks/completion.ts
//
// The single write path for turning a PENDING PaymentLinkPayment into a
// CONFIRMED one. Both settlement paths funnel through here:
//   - wallet path: lib/paymentLinks/reconciliation.ts, once an inbound
//     onchain transfer is matched to a session
//   - card/ACH path: app/api/webhooks/circle-payments/route.ts, once
//     Circle reports the payment (and its USDC settlement) as complete
//
// Must be called from WITHIN the same DB transaction that creates/confirms
// the settling OnchainTransaction row — same invariant as
// lib/invoices/reconciliation.ts, for the same reason: a checkout session
// (and any invoice it settles) must never flip to CONFIRMED/PAID off a
// transfer whose own write later rolls back.

import type { Prisma } from "@/app/generated/prisma/client";
import { recordEntry } from "@/lib/ledger/engine";
import { markInvoicePaid } from "@/lib/invoices/reconciliation";

type Tx = Prisma.TransactionClient;

export interface ConfirmPaymentLinkPaymentInput {
  paymentLinkPaymentId: string;
  onchainTransactionId: string;
  /** Amount actually settled, in smallest USDC unit — credited verbatim. */
  amountPaid: bigint;
  /** Overwrites payerIdentifier if the settlement path learned a better one (e.g. the sending wallet address) and none was recorded at session-start. */
  payerIdentifier?: string;
}

export interface ConfirmPaymentLinkPaymentResult {
  paymentLinkId: string;
  invoiceId?: string;
  linkExpired: boolean;
}

export async function confirmPaymentLinkPayment(
  tx: Tx,
  input: ConfirmPaymentLinkPaymentInput
): Promise<ConfirmPaymentLinkPaymentResult> {
  const session = await tx.paymentLinkPayment.findUniqueOrThrow({
    where: { id: input.paymentLinkPaymentId },
    include: { paymentLink: { include: { invoice: { select: { id: true } } } } },
  });

  const link = session.paymentLink;

  await recordEntry(
    {
      ledgerAccountId: link.receivingLedgerAccountId,
      amount: input.amountPaid,
      direction: "CREDIT",
      referenceType: "ONCHAIN_TX",
      referenceId: input.onchainTransactionId,
    },
    tx
  );

  await tx.paymentLinkPayment.update({
    where: { id: session.id },
    data: {
      status: "CONFIRMED",
      amountPaid: input.amountPaid,
      txId: input.onchainTransactionId,
      confirmedAt: new Date(),
      ...(input.payerIdentifier && !session.payerIdentifier
        ? { payerIdentifier: input.payerIdentifier }
        : {}),
    },
  });

  const newUseCount = link.useCount + 1;
  const exhausted = link.maxUses !== null && newUseCount >= link.maxUses;

  await tx.paymentLink.update({
    where: { id: link.id },
    data: {
      useCount: newUseCount,
      ...(exhausted ? { status: "EXPIRED" } : {}),
    },
  });

  if (link.invoice) {
    await markInvoicePaid(tx, link.invoice.id, input.onchainTransactionId);
  }

  return {
    paymentLinkId: link.id,
    invoiceId: link.invoice?.id,
    linkExpired: exhausted,
  };
}