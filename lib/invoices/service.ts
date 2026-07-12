// lib/invoices/service.ts
//
// Invoice business logic. Mirrors the shape of lib/contacts/service.ts:
// this is the only module that writes Invoice/InvoiceEvent rows outside
// of lib/invoices/reconciliation.ts (which owns the PAID transition).
//
// Money invariant: subtotal/total are ALWAYS computed server-side from
// lineItems via lib/invoices/money.ts — a client-submitted total is
// never trusted or persisted verbatim.

import { prisma } from "@/lib/db/prisma";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { toDecimalString } from "@/lib/circle/amount";
import { computeLineItems, parseTaxAmount, InvoiceValidationError, type RawLineItemInput } from "./money";
import { createPaymentLinkForInvoice } from "@/lib/paymentLinks/stub";
import {
  sendInvoiceCreatedEmail,
  notifyInAppInvoiceReceived,
} from "@/lib/notifications/notify";
import type { Invoice, InvoiceEvent, InvoiceStatus } from "@/app/generated/prisma/client";

export { InvoiceValidationError };

export class InvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice not found");
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceStateError";
  }
}

// Only USDC settles today; EURC exists in the schema/enum for forward
// compatibility but is rejected here until Phase 4 FX exists.
const SUPPORTED_CREATION_CURRENCIES = new Set(["USDC"]);

export interface CreateInvoiceInput {
  orgId: string;
  recipientIdentifier: string;
  recipientEmail?: string;
  lineItems: RawLineItemInput[];
  taxAmount?: string; // decimal string, issuer-entered
  currency?: string;
  dueDate: string; // ISO date string
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDueDate(raw: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new InvoiceValidationError(`"${raw}" isn't a valid due date.`);
  }
  if (date < startOfToday()) {
    throw new InvoiceValidationError("Due date can't be in the past.");
  }
  return date;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const currency = input.currency?.trim().toUpperCase() || "USDC";
  if (!SUPPORTED_CREATION_CURRENCIES.has(currency)) {
    throw new InvoiceValidationError(
      `Invoices in ${currency} aren't supported yet — only USDC, for now.`
    );
  }

  const recipientIdentifier = input.recipientIdentifier?.trim();
  if (!recipientIdentifier) {
    throw new InvoiceValidationError("A recipient (username, address, or email) is required.");
  }

  // Server-computed totals — never trust client-submitted numbers.
  const { items, subtotal } = computeLineItems(input.lineItems);
  const taxAmount = parseTaxAmount(input.taxAmount);
  const total = subtotal + taxAmount;
  if (total <= 0n) {
    throw new InvoiceValidationError("Invoice total must be greater than zero.");
  }

  const dueDate = parseDueDate(input.dueDate);

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        orgId: input.orgId,
        recipientIdentifier,
        recipientEmail: input.recipientEmail?.trim() || null,
        lineItems: items as never,
        subtotal,
        taxAmount,
        total,
        currency: currency as "USDC" | "EURC",
        status: "DRAFT",
        dueDate,
      },
    });

    await tx.invoiceEvent.create({
      data: { invoiceId: created.id, eventType: "CREATED" },
    });

    return created;
  });

  // Auto-generate a payment link — stubbed until Phase 4 exists. Never
  // block invoice creation on this; the public page falls back cleanly
  // to the direct-address flow if paymentLinkId stays null.
  try {
    const paymentLinkId = await createPaymentLinkForInvoice(invoice.id);
    if (paymentLinkId) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { paymentLinkId } });
      return { ...invoice, paymentLinkId };
    }
  } catch (err) {
    console.error(`[invoices] payment link creation failed for invoice ${invoice.id}`, err);
  }

  return invoice;
}

export async function getInvoice(orgId: string, invoiceId: string): Promise<Invoice & { events: InvoiceEvent[] }> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, orgId },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!invoice) throw new InvoiceNotFoundError();
  return invoice;
}

export interface ListInvoicesFilter {
  status?: InvoiceStatus;
}

export async function listInvoices(orgId: string, filter: ListInvoicesFilter = {}): Promise<Invoice[]> {
  return prisma.invoice.findMany({
    where: { orgId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Transitions DRAFT -> SENT: stamps sentAt, logs the SENT event, and
 * fires the recipient email (+ in-app notification if the recipient
 * resolves to an existing Comparta org). Only DRAFT invoices can be sent —
 * resending an already-SENT invoice is POST /api/invoices/:id/remind
 * territory, not this.
 */
export async function sendInvoice(orgId: string, invoiceId: string, publicBaseUrl: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, orgId } });
  if (!invoice) throw new InvoiceNotFoundError();
  if (invoice.status !== "DRAFT") {
    throw new InvoiceStateError(`Invoice is ${invoice.status}, not DRAFT — it may already have been sent.`);
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "SENT", sentAt: new Date() },
    });
    await tx.invoiceEvent.create({ data: { invoiceId, eventType: "SENT" } });
    return result;
  });

  // Delivery is best-effort and never rolls back the SENT transition —
  // the invoice exists and is viewable via its public link regardless of
  // whether the email actually lands.
  const recipientEmail = resolveRecipientEmail(invoice.recipientIdentifier, invoice.recipientEmail);
  if (recipientEmail) {
    sendInvoiceCreatedEmail({
      invoiceId,
      orgLegalName: org.legalName,
      recipientEmail,
      total: toDecimalString(updated.total),
      currency: updated.currency,
      dueDate: updated.dueDate,
      publicUrl: `${publicBaseUrl}/invoice/${invoiceId}`,
    }).catch((err) => console.error(`[invoices] send email failed for ${invoiceId}`, err));
  }

  resolveRecipientOrgId(invoice.recipientIdentifier)
    .then((recipientOrgId) => {
      if (recipientOrgId) return notifyInAppInvoiceReceived(recipientOrgId, invoiceId);
    })
    .catch((err) => console.error(`[invoices] in-app notify failed for ${invoiceId}`, err));

  return updated;
}

/** True if recipientIdentifier itself is email-shaped (no dedicated identity system for email). */
function resolveRecipientEmail(recipientIdentifier: string, recipientEmail: string | null): string | null {
  if (recipientEmail) return recipientEmail;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientIdentifier) ? recipientIdentifier : null;
}

/** Best-effort: does recipientIdentifier resolve to an existing Comparta org (username/address)? */
async function resolveRecipientOrgId(recipientIdentifier: string): Promise<string | undefined> {
  try {
    const resolved = await resolve(recipientIdentifier);
    return resolved.orgId;
  } catch (err) {
    if (err instanceof ResolverError) return undefined; // email or unclaimed identifier — not an org
    throw err;
  }
}

/**
 * Blocks voiding an already-PAID invoice — contradictory states aren't
 * allowed. Voiding any other non-terminal status (DRAFT/SENT/VIEWED/
 * OVERDUE) is fine.
 */
export async function voidInvoice(orgId: string, invoiceId: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, orgId } });
  if (!invoice) throw new InvoiceNotFoundError();
  if (invoice.status === "PAID") {
    throw new InvoiceStateError("This invoice has already been paid and can't be voided.");
  }
  if (invoice.status === "VOID") {
    return invoice; // idempotent no-op
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID" } });
    await tx.invoiceEvent.create({ data: { invoiceId, eventType: "VOID" } });
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Public (unauthenticated) view
// ─────────────────────────────────────────────────────────────────────────

export interface PublicInvoice {
  id: string;
  orgLegalName: string;
  recipientIdentifier: string;
  lineItems: unknown;
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  dueDate: Date;
  paidAt: Date | null;
  paymentLinkId: string | null;
  payToAddress: string | null; // fallback direct-pay address when no payment link exists yet
}

export async function getPublicInvoice(invoiceId: string): Promise<PublicInvoice> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { organization: { include: { wallets: { take: 1 } } } },
  });
  if (!invoice || invoice.status === "DRAFT") {
    // DRAFT invoices aren't public yet — treat as not-found rather than
    // leaking an unsent invoice's contents to anyone who guesses its id.
    throw new InvoiceNotFoundError();
  }

  return {
    id: invoice.id,
    orgLegalName: invoice.organization.legalName,
    recipientIdentifier: invoice.recipientIdentifier,
    lineItems: invoice.lineItems,
    subtotal: toDecimalString(invoice.subtotal),
    taxAmount: toDecimalString(invoice.taxAmount),
    total: toDecimalString(invoice.total),
    currency: invoice.currency,
    status: invoice.status,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    paymentLinkId: invoice.paymentLinkId,
    payToAddress: invoice.organization.wallets[0]?.arcAddress ?? null,
  };
}

const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes — collapses page refreshes, not genuine re-visits

/**
 * Logs a VIEWED event on public page load, deduped so a refresh spam
 * doesn't flood the timeline. Also transitions SENT -> VIEWED (only ever
 * forward — never downgrades PAID/OVERDUE/VOID back to VIEWED).
 */
export async function recordInvoiceViewed(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  if (!invoice || invoice.status === "DRAFT") return;

  const lastView = await prisma.invoiceEvent.findFirst({
    where: { invoiceId, eventType: "VIEWED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const withinDedupeWindow =
    lastView && Date.now() - lastView.createdAt.getTime() < VIEW_DEDUPE_WINDOW_MS;
  if (withinDedupeWindow) return;

  await prisma.$transaction(async (tx) => {
    await tx.invoiceEvent.create({ data: { invoiceId, eventType: "VIEWED" } });
    if (invoice.status === "SENT") {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VIEWED" } });
    }
  });
}