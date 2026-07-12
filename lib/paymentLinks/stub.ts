// lib/paymentLinks/stub.ts
//
// TODO(Phase 4): Payment Links aren't built yet. Once they are, this
// should create a real PaymentLink row scoped to this invoice (amount
// locked, single-use, expires with the invoice) and return its id, which
// Invoice.paymentLinkId then stores. The public invoice page's "Pay Now"
// button routes into that payment link's checkout flow.
//
// Until then, invoice creation calls this, gets `null` back, and the
// public invoice page falls back to showing the issuer's Arc address
// directly (see app/invoice/[id]/page.tsx) — auto-reconciliation matches
// the resulting inbound transfer by exact amount instead of by payment
// link (see lib/invoices/reconciliation.ts).

export async function createPaymentLinkForInvoice(invoiceId: string): Promise<string | null> {
  console.log(
    `[paymentLinks] TODO(Phase 4): payment link creation not implemented — invoice ${invoiceId} ` +
      `will use the direct-address fallback on its public page.`
  );
  return null;
}