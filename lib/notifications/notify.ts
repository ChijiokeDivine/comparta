// lib/notifications/notify.ts
//
// Email (Resend) and in-app notification hooks. Same pattern as
// notifyPaymentReceived in lib/transfers/receive.ts and
// notifyPaymentFailed in jobs/confirmTransaction.ts.
//
// Every function here is deliberately best-effort: callers should never
// let a notification failure roll back or fail the underlying invoice
// operation (creation, sending, payment). Catch at the call site.

import { Resend } from "resend";

const RESEND_FROM = "Comparta <hello@comparta.xyz>";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface InvoiceEmailContext {
  invoiceId: string;
  orgLegalName: string;
  recipientEmail: string;
  total: string; // decimal string
  currency: string;
  dueDate: Date;
  publicUrl: string;
}

function formatMoneyEmail(decimalString: string): string {
  const [whole, frac = ""] = decimalString.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

function formatDateEmail(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Table-based layout with fully inline styles. Email clients (Outlook,
 * Gmail app, etc.) strip or mangle <style> blocks and modern CSS
 * (flexbox, gap) unpredictably, so every rule lives on the element.
 */
function buildInvoiceEmailHtml(ctx: InvoiceEmailContext, opts?: { reminder?: boolean; daysPastDue?: number }): string {
  const amountLine = `${formatMoneyEmail(ctx.total)} ${ctx.currency}`;
  const dueLine = formatDateEmail(ctx.dueDate);
  const isOverdue = !!opts?.reminder && !!opts.daysPastDue && opts.daysPastDue > 0;

  const heading = isOverdue
    ? `Overdue by ${opts!.daysPastDue} day${opts!.daysPastDue === 1 ? "" : "s"}`
    : opts?.reminder
      ? `Invoice due ${dueLine}`
      : `New invoice from ${ctx.orgLegalName}`;

  const pill = isOverdue
    ? `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#FEF2F2;color:#B91C1C;font-size:12px;font-weight:600;border:1px solid #FECACA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Overdue</span>`
    : opts?.reminder
      ? `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#FFFBEB;color:#92400E;font-size:12px;font-weight:600;border:1px solid #FDE68A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Reminder</span>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F8FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" >
  <tr>
    <td align="center" style="padding:40px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid #E5E9F2;border-radius:16px;">
        <tr>
          <td style="padding:40px 36px 32px;">

            <!-- Wordmark -->
            <p style="margin:0 0 24px;font-size:13px;font-weight:700;color:#2A5CE6;letter-spacing:0.02em;">Comparta</p>

            <!-- Status pill -->
            ${pill ? `<div style="margin-bottom:14px;">${pill}</div>` : ""}

            <!-- Heading -->
            <h1 style="margin:0 0 28px;font-size:20px;font-weight:700;color:#0B1E3F;line-height:1.3;">${heading}</h1>

            <!-- Amount -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F8FB;border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:18px 10px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#7C8CA6;text-transform:uppercase;letter-spacing:0.05em;">Amount due</p>
                  <p style="margin:0;font-size:28px;font-weight:700;color:#0B1E3F;font-variant-numeric:tabular-nums;">${amountLine}</p>
                </td>
              </tr>
            </table>

            <!-- Meta -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="padding:0 0 10px;font-size:13px;color:#7C8CA6;">From</td>
                <td style="padding:0 0 10px;font-size:13px;color:#0B1E3F;font-weight:600;text-align:right;">${ctx.orgLegalName}</td>
              </tr>
              <tr>
                <td style="padding:0 0 10px;border-top:1px solid #F2F4F8;padding-top:10px;font-size:13px;color:#7C8CA6;">Due date</td>
                <td style="padding:0 0 10px;border-top:1px solid #F2F4F8;padding-top:10px;font-size:13px;color:#0B1E3F;font-weight:600;text-align:right;">${dueLine}</td>
              </tr>
              <tr>
                <td style="border-top:1px solid #F2F4F8;padding-top:10px;font-size:13px;color:#7C8CA6;">Invoice</td>
                <td style="border-top:1px solid #F2F4F8;padding-top:10px;font-size:13px;color:#0B1E3F;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;">${ctx.invoiceId.slice(0, 8)}&hellip;${ctx.invoiceId.slice(-5)}</td>
              </tr>
            </table>

            <!-- CTA -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background-color:#2A5CE6;border-radius:10px;">
                  <a href="${ctx.publicUrl}" target="_blank" rel="noopener noreferrer" style="display:block;padding:13px 24px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">View &amp; pay invoice</a>
                </td>
              </tr>
            </table>

          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px 28px;border-top:1px solid #F2F4F8;">
            <p style="margin:0;font-size:11px;color:#B3BDD1;line-height:1.6;"> Comparta</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildInvoiceEmailText(ctx: InvoiceEmailContext, opts?: { reminder?: boolean; daysPastDue?: number }): string {
  const amountLine = `${formatMoneyEmail(ctx.total)} ${ctx.currency}`;
  const dueLine = formatDateEmail(ctx.dueDate);
  const heading = opts?.reminder
    ? opts.daysPastDue && opts.daysPastDue > 0
      ? `Invoice overdue by ${opts.daysPastDue} day${opts.daysPastDue === 1 ? "" : "s"}`
      : `Payment reminder from ${ctx.orgLegalName}`
    : `New invoice from ${ctx.orgLegalName}`;

  return `${heading}

Amount due: ${amountLine}
From: ${ctx.orgLegalName}
Due date: ${dueLine}
Invoice: ${ctx.invoiceId}

${ctx.publicUrl}

— Comparta`;
}

async function sendInvoiceEmail(
  ctx: InvoiceEmailContext,
  subject: string,
  idempotencyKey: string,
  opts?: { reminder?: boolean; daysPastDue?: number }
): Promise<void> {
  if (!resend) {
    console.log(
      `[notify] RESEND_API_KEY not set - would email invoice ${ctx.invoiceId} to ${ctx.recipientEmail}: ${subject}`
    );
    return;
  }

  const { data, error } = await resend.emails.send({
    from: RESEND_FROM,
    to: [ctx.recipientEmail],
    subject,
    html: buildInvoiceEmailHtml(ctx, opts),
    text: buildInvoiceEmailText(ctx, opts),
    // idempotencyKey,
    tags: [
      { name: "category", value: opts?.reminder ? "invoice-reminder" : "invoice-created" },
      { name: "invoice_id", value: ctx.invoiceId },
    ],
  });

  if (error) {
    console.error(`[notify] resend failed for invoice ${ctx.invoiceId} -> ${ctx.recipientEmail}`, error);
    return;
  }

  console.log(`[notify] invoice ${ctx.invoiceId} emailed to ${ctx.recipientEmail} (id=${data?.id ?? "?"})`);
}

/** Sent when an invoice transitions DRAFT -> SENT. */
export async function sendInvoiceCreatedEmail(ctx: InvoiceEmailContext): Promise<void> {
  const subject = `${ctx.orgLegalName} sent you an invoice`;
  await sendInvoiceEmail(ctx, subject, `invoice-sent/${ctx.invoiceId}`);
}

/** Sent for the rate-limited overdue reminder schedule (due date, +3d, +7d). */
export async function sendInvoiceReminderEmail(
  ctx: InvoiceEmailContext & { daysPastDue: number }
): Promise<void> {
  const subject =
    ctx.daysPastDue > 0
      ? `Overdue: ${ctx.orgLegalName} invoice (${ctx.daysPastDue}d past due)`
      : `Reminder: ${ctx.orgLegalName} invoice due ${formatDateEmail(ctx.dueDate)}`;
  await sendInvoiceEmail(
    ctx,
    subject,
    `invoice-reminder/${ctx.invoiceId}/${ctx.daysPastDue}d`,
    { reminder: true, daysPastDue: ctx.daysPastDue }
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
 * manual review. v1 has no dedicated queue/table for this - it's a loud
 * log line an operator monitors, same posture as the reconciliation
 * worker's mismatch logging in jobs/workers/reconciliation.worker.ts.
 */
export async function flagPaymentForManualReconciliation(
  orgId: string,
  onchainTransactionId: string,
  reason: string
): Promise<void> {
  console.error(
    `[notify] MANUAL RECONCILIATION NEEDED: org ${orgId}, onchainTransaction ${onchainTransactionId} - ${reason}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// OTP EMAILS (password reset + account verification)
// ─────────────────────────────────────────────────────────────────────────
//
// Both flows use a 6-digit numeric code, delivered in a generously-spaced,
// minimal-text layout so the code is immediately scannable.  Same
// table-based, inline-style posture as the invoice emails (Outlook/Gmail
// app safe).

export interface OtpEmailContext {
  recipientEmail: string;
  code: string; // 6 digits, e.g. "482019"
}

/**
 * Formats the 6-digit OTP into two spaced groups of 3 for readability,
 * e.g. "482019" → "482 019".  Keeps digits visually close but gives the
 * eye a break — the goal is instant copy/read, not an eyechart.
 */
function formatOtpDisplay(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * Shared skeleton for both OTP emails.  `kind` switches:
 *   - "reset":    heading "Reset your Comparta password", body hint about the code expiring, no action suggested beyond entering it
 *   - "verify":   heading "Verify your email", body welcoming them and confirming the code is for their new account
 */
function buildOtpEmailHtml(
  ctx: OtpEmailContext,
  kind: "reset" | "verify"
): string {
  const displayCode = formatOtpDisplay(ctx.code);

  const heading =
    kind === "reset"
      ? "Reset your password"
      : "Verify your email";

  const eyebrow =
    kind === "reset"
      ? "Password reset requested"
      : "Welcome to Comparta";

  // One short, clear paragraph — no wall of text.
  const bodyLine =
    kind === "reset"
      ? "Enter the 6-digit code below to set a new password for your Comparta account."
      : "Enter the 6-digit code below to confirm your email address and finish creating your account.";

  const expiryHint = "This code expires in 15 minutes and can only be used once.";
  const footerLine =
    kind === "reset"
      ? "If you didn't request a password reset, you can safely ignore this email."
      : "If you didn't create a Comparta account, you can safely ignore this email.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" >
  <tr>
    <td align="center" style="padding:48px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid #E5E9F2;border-radius:16px;">
        <tr>
          <td style="padding:48px 20px 44px;">

            <!-- Wordmark -->
            <p style="margin:0 0 40px;font-size:13px;font-weight:700;color:#2A5CE6;letter-spacing:0.02em;">Comparta</p>

            <!-- Eyebrow / tiny meta -->
            <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#7C8CA6;text-transform:uppercase;letter-spacing:0.06em;">${eyebrow}</p>

            <!-- Heading (generous bottom space before the body) -->
            <h1 style="margin:0 0 28px;font-size:24px;font-weight:600;color:#0B1E3F;line-height:1.25;">${heading}</h1>

            <!-- Single body paragraph, light weight, good line height -->
            <p style="margin:0 0 36px;font-size:14px;color:#52617A;line-height:1.65;">${bodyLine}</p>

            <!--
              OTP code block:
                - large, generously padded card
                - monospaced numerals
                - generous letter-spacing for scannability
                - soft accent background, not screaming red/blue
            -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center" style="background-color:#F0F4FF;border-radius:12px;border:1px solid #DCE4F9;padding:28px 20px;">
                  <p style="margin:0;font-size:36px;font-weight:700;color:#0B1E3F;letter-spacing:0.25em;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace;">${displayCode}</p>
                </td>
              </tr>
            </table>

            <!-- Expiry / safety line -->
            <p style="margin:0 0 0;font-size:12px;color:#7C8CA6;line-height:1.6;">${expiryHint}</p>

          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 32px;border-top:1px solid #F2F4F8;">
            <p style="margin:0;font-size:11px;color:#B3BDD1;line-height:1.6;">${footerLine}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildOtpEmailText(
  ctx: OtpEmailContext,
  kind: "reset" | "verify"
): string {
  const subject =
    kind === "reset"
      ? "Your Comparta password reset code"
      : "Verify your Comparta email";

  const body =
    kind === "reset"
      ? `Your 6-digit password reset code for Comparta:

${ctx.code}

This code expires in 15 minutes and can only be used once.

If you didn't request a password reset, you can safely ignore this email.

— Comparta`
      : `Welcome to Comparta. Your 6-digit email verification code:

${ctx.code}

This code expires in 15 minutes and can only be used once.

If you didn't create a Comparta account, you can safely ignore this email.

`;

  return `${subject}

${body}`;
}

/** Shared low-level send.  Best-effort, never throws on failure. */
async function sendOtpEmail(
  ctx: OtpEmailContext,
  kind: "reset" | "verify",
  idempotencyKey: string
): Promise<void> {
  if (!resend) {
    const label = kind === "reset" ? "password-reset OTP" : "email-verification OTP";
    console.log(
      `[notify] RESEND_API_KEY not set - would email ${label} ${ctx.code} to ${ctx.recipientEmail}`
    );
    return;
  }

  const subject =
    kind === "reset"
      ? `Your Comparta password reset code: ${ctx.code}`
      : `Verify your Comparta email: ${ctx.code}`;

  const { data, error } = await resend.emails.send({
    from: RESEND_FROM,
    to: [ctx.recipientEmail],
    subject,
    html: buildOtpEmailHtml(ctx, kind),
    text: buildOtpEmailText(ctx, kind),
    // idempotencyKey,
    tags: [
      { name: "category", value: kind === "reset" ? "password-reset-otp" : "email-verification-otp" },
    ],
  });

  if (error) {
    console.error(
      `[notify] resend failed for OTP email (${kind}) to ${ctx.recipientEmail}`,
      error
    );
    return;
  }

  console.log(
    `[notify] OTP email (${kind}) sent to ${ctx.recipientEmail} (id=${data?.id ?? "?"})`
  );
}

/** Sent when a user clicks "Forgot password" and enters their email. */
export async function sendPasswordResetOtpEmail(ctx: OtpEmailContext): Promise<void> {
  // idempotency: (email + truncated-to-minute timestamp) so the same user
  // hammering "resend" within 60s shares the idempotency key and Resend
  // (if idempotency is re-enabled above) won't double-send the same code
  // minute-windowed email.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const idemKey = `otp/password-reset/${ctx.recipientEmail}/${minuteBucket}`;
  await sendOtpEmail(ctx, "reset", idemKey);
}

/** Sent immediately after a brand-new credentials account is created, to confirm ownership. */
export async function sendEmailVerificationOtpEmail(ctx: OtpEmailContext): Promise<void> {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const idemKey = `otp/email-verification/${ctx.recipientEmail}/${minuteBucket}`;
  await sendOtpEmail(ctx, "verify", idemKey);
}