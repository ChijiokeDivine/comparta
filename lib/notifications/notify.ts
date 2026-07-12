// lib/notifications/notify.ts
//
// Placeholder notification hooks — same pattern as notifyPaymentReceived
// in lib/transfers/receive.ts and notifyPaymentFailed in
// jobs/confirmTransaction.ts. Wire up to real email/in-app infra once it
// exists; logging loudly in the meantime so these are at least visible
// in application logs during development.
//
// Every function here is deliberately best-effort: callers should never
// let a notification failure roll back or fail the underlying invoice
// operation (creation, sending, payment). Catch at the call site.

export interface InvoiceEmailContext {
  invoiceId: string;
  orgLegalName: string;
  recipientEmail: string;
  total: string; // decimal string
  currency: string;
  dueDate: Date;
  publicUrl: string;
}

/** Sent when an invoice transitions DRAFT -> SENT. */
export async function sendInvoiceCreatedEmail(ctx: InvoiceEmailContext): Promise<void> {
  console.log(
    `[notify] TODO: email invoice ${ctx.invoiceId} to ${ctx.recipientEmail} — ` +
      `"${ctx.orgLegalName} sent you an invoice for ${ctx.total} ${ctx.currency}, due ${ctx.dueDate.toISOString()}. ` +
      `View it: ${ctx.publicUrl}"`
  );
}

/** Sent for the rate-limited overdue reminder schedule (due date, +3d, +7d). */
export async function sendInvoiceReminderEmail(
  ctx: InvoiceEmailContext & { daysPastDue: number }
): Promise<void> {
  console.log(
    `[notify] TODO: reminder email for invoice ${ctx.invoiceId} to ${ctx.recipientEmail} — ` +
      `${ctx.daysPastDue} day(s) past due. View it: ${ctx.publicUrl}`
  );
}

/** In-app notification when the invoice recipient happens to be an existing Comparta org. */
export async function notifyInAppInvoiceReceived(recipientOrgId: string, invoiceId: string): Promise<void> {
  console.log(`[notify] TODO: in-app notify org ${recipientOrgId} of new invoice ${invoiceId}`);
}

/** Notifies the issuing org once an invoice auto-reconciles to PAID. */
export async function notifyIssuerInvoicePaid(issuerOrgId: string, invoiceId: string): Promise<void> {
  console.log(`[notify] TODO: notify issuer org ${issuerOrgId} that invoice ${invoiceId} was paid`);
}

/**
 * Flags an inbound payment that couldn't be cleanly reconciled to exactly
 * one invoice (amount matched zero or more-than-one open invoice) for
 * manual review. v1 has no dedicated queue/table for this — it's a loud
 * log line an operator monitors, same posture as the reconciliation
 * worker's mismatch logging in jobs/workers/reconciliation.worker.ts.
 */
export async function flagPaymentForManualReconciliation(
  orgId: string,
  onchainTransactionId: string,
  reason: string
): Promise<void> {
  console.error(
    `[notify] MANUAL RECONCILIATION NEEDED: org ${orgId}, onchainTransaction ${onchainTransactionId} — ${reason}`
  );
}