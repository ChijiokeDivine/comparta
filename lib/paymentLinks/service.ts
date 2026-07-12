// lib/paymentLinks/service.ts
//
// Payment link business logic: creation, listing/management, and status
// transitions. Mirrors the shape of lib/invoices/service.ts and
// lib/contacts/service.ts. The public (unauthenticated) checkout view
// lives in lib/paymentLinks/checkout.ts, not here — this module is the
// merchant-facing side.

import { prisma } from "@/lib/db/prisma";
import { toSmallestUnit } from "@/lib/circle/amount";
import { withUniqueSlug } from "./slug";
import type { PaymentLink, PaymentLinkType } from "@/app/generated/prisma/client";

export class PaymentLinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentLinkValidationError";
  }
}

export class PaymentLinkNotFoundError extends Error {
  constructor() {
    super("Payment link not found");
    this.name = "PaymentLinkNotFoundError";
  }
}

export class PaymentLinkStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentLinkStateError";
  }
}

// A payer never sees $0.00 or a fractional-cent amount presented as
// "free" — mirrors the floor used elsewhere for money validation.
const MIN_AMOUNT_SMALLEST_UNIT = 1n;

export interface CreatePaymentLinkInput {
  orgId: string;
  type: PaymentLinkType;
  /** Decimal string, required iff type = FIXED_AMOUNT. Rejected if present for OPEN_AMOUNT. */
  amount?: string;
  description?: string;
  /** ISO date string. Must be in the future if provided. */
  expiresAt?: string;
  maxUses?: number;
  receivingLedgerAccountId: string;
}

function parseExpiresAt(raw: string | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new PaymentLinkValidationError(`"${raw}" isn't a valid expiry date.`);
  }
  if (date <= new Date()) {
    throw new PaymentLinkValidationError("Expiry date must be in the future.");
  }
  return date;
}

function parseMaxUses(raw: number | undefined): number | null {
  if (raw === undefined) return null;
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new PaymentLinkValidationError("Usage limit must be a positive whole number.");
  }
  return raw;
}

/** Validates the type/amount combination and returns the smallest-unit amount (null for OPEN_AMOUNT). */
function parseAmountForType(type: PaymentLinkType, amount: string | undefined): bigint | null {
  if (type === "FIXED_AMOUNT") {
    if (!amount || !amount.trim()) {
      throw new PaymentLinkValidationError("A fixed-amount link requires an amount.");
    }
    let smallest: bigint;
    try {
      smallest = toSmallestUnit(amount);
    } catch {
      throw new PaymentLinkValidationError(`"${amount}" isn't a valid USDC amount.`);
    }
    if (smallest < MIN_AMOUNT_SMALLEST_UNIT) {
      throw new PaymentLinkValidationError("Amount must be greater than zero.");
    }
    return smallest;
  }

  // OPEN_AMOUNT
  if (amount !== undefined && amount.trim() !== "") {
    throw new PaymentLinkValidationError("An open-amount link cannot have a fixed amount set.");
  }
  return null;
}

async function assertLedgerAccountBelongsToOrg(orgId: string, ledgerAccountId: string): Promise<void> {
  const account = await prisma.ledgerAccount.findFirst({
    where: { id: ledgerAccountId, orgId },
    select: { id: true },
  });
  if (!account) {
    throw new PaymentLinkValidationError("The selected balance bucket doesn't belong to your organization.");
  }
}

export async function createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
  const amount = parseAmountForType(input.type, input.amount);
  const expiresAt = parseExpiresAt(input.expiresAt);
  const maxUses = parseMaxUses(input.maxUses);
  await assertLedgerAccountBelongsToOrg(input.orgId, input.receivingLedgerAccountId);

  const description = input.description?.trim() || null;
  if (description && description.length > 500) {
    throw new PaymentLinkValidationError("Description is too long (max 500 characters).");
  }

  return withUniqueSlug((slug) =>
    prisma.paymentLink.create({
      data: {
        orgId: input.orgId,
        slug,
        type: input.type,
        amount,
        description,
        expiresAt,
        maxUses,
        receivingLedgerAccountId: input.receivingLedgerAccountId,
      },
    })
  );
}

export interface ListPaymentLinksFilter {
  status?: "ACTIVE" | "PAUSED" | "EXPIRED";
}

export async function listPaymentLinks(
  orgId: string,
  filter: ListPaymentLinksFilter = {}
): Promise<(PaymentLink & { _count: { payments: number } })[]> {
  return prisma.paymentLink.findMany({
    where: { orgId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { payments: { where: { status: "CONFIRMED" } } } } },
  });
}

export async function getPaymentLink(orgId: string, id: string): Promise<PaymentLink> {
  const link = await prisma.paymentLink.findFirst({ where: { id, orgId } });
  if (!link) throw new PaymentLinkNotFoundError();
  return link;
}

export interface PaymentLinkUsageStats {
  link: PaymentLink;
  confirmedPaymentCount: number;
  totalCollected: bigint;
  payments: {
    id: string;
    payerIdentifier: string | null;
    method: string;
    amountPaid: bigint | null;
    status: string;
    createdAt: Date;
    confirmedAt: Date | null;
  }[];
}

export async function getPaymentLinkWithUsage(orgId: string, id: string): Promise<PaymentLinkUsageStats> {
  const link = await getPaymentLink(orgId, id);
  const payments = await prisma.paymentLinkPayment.findMany({
    where: { paymentLinkId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      payerIdentifier: true,
      method: true,
      amountPaid: true,
      status: true,
      createdAt: true,
      confirmedAt: true,
    },
  });

  const confirmed = payments.filter((p) => p.status === "CONFIRMED");
  const totalCollected = confirmed.reduce((sum, p) => sum + (p.amountPaid ?? 0n), 0n);

  return { link, confirmedPaymentCount: confirmed.length, totalCollected, payments };
}

/** Pauses an ACTIVE link — payer-facing checkout starts returning "unavailable". Idempotent. */
export async function pausePaymentLink(orgId: string, id: string): Promise<PaymentLink> {
  const link = await getPaymentLink(orgId, id);
  if (link.status === "EXPIRED") {
    throw new PaymentLinkStateError("This link has already expired and can't be paused/resumed.");
  }
  if (link.status === "PAUSED") return link;
  return prisma.paymentLink.update({ where: { id }, data: { status: "PAUSED" } });
}

// ─────────────────────────────────────────────────────────────────────────
// Invoice integration (replaces lib/paymentLinks/stub.ts from Phase 3)
// ─────────────────────────────────────────────────────────────────────────

/** Grace period past an invoice's dueDate during which its payment link still accepts payment (an overdue invoice is still payable — see jobs/invoiceOverdue.worker.ts, which never voids on its own). */
const INVOICE_LINK_GRACE_PERIOD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Creates a single-use, amount-locked PaymentLink for a just-created
 * invoice. Called from lib/invoices/service.ts#createInvoice, which
 * treats a null/thrown result as non-fatal (see that module) — the
 * public invoice page falls back to the direct-address flow if this
 * never runs or fails.
 *
 * type=FIXED_AMOUNT, amount=invoice total, maxUses=1: exactly one
 * successful payment can ever be made through this link, matching an
 * invoice's own one-shot PAID transition.
 */
export async function createPaymentLinkForInvoice(input: {
  invoiceId: string;
  orgId: string;
  totalSmallestUnit: bigint;
  currency: "USDC" | "EURC";
  dueDate: Date;
}): Promise<string | null> {
  if (input.currency !== "USDC") {
    // Only USDC settles onchain today (see lib/invoices/service.ts) — a
    // payment link for a currency we can't actually settle would be
    // actively misleading, so skip it rather than create a broken link.
    return null;
  }

  const receivingLedgerAccountId = await resolveOrgDefaultLedgerAccountId(input.orgId);
  if (!receivingLedgerAccountId) {
    console.error(
      `[paymentLinks] Org ${input.orgId} has no default/Operating ledger account — cannot create ` +
        `payment link for invoice ${input.invoiceId}.`
    );
    return null;
  }

  const link = await withUniqueSlug((slug) =>
    prisma.paymentLink.create({
      data: {
        orgId: input.orgId,
        slug,
        type: "FIXED_AMOUNT",
        amount: input.totalSmallestUnit,
        description: `Invoice ${input.invoiceId}`,
        maxUses: 1,
        expiresAt: new Date(input.dueDate.getTime() + INVOICE_LINK_GRACE_PERIOD_MS),
        receivingLedgerAccountId,
      },
    })
  );

  return link.id;
}

async function resolveOrgDefaultLedgerAccountId(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { defaultLedgerAccountId: true },
  });
  if (org?.defaultLedgerAccountId) return org.defaultLedgerAccountId;

  const operating = await prisma.ledgerAccount.findFirst({
    where: { orgId, name: "Operating" },
    select: { id: true },
  });
  return operating?.id ?? null;
}

/** Resumes a PAUSED link back to ACTIVE. Idempotent. Refuses to resume an EXPIRED link. */
export async function resumePaymentLink(orgId: string, id: string): Promise<PaymentLink> {
  const link = await getPaymentLink(orgId, id);
  if (link.status === "EXPIRED") {
    throw new PaymentLinkStateError("This link has already expired and can't be resumed. Create a new one.");
  }
  if (link.status === "ACTIVE") return link;

  // Resuming a link whose expiresAt has already passed would just have it
  // get swept back to EXPIRED on the next run of
  // jobs/paymentLinkExpiry.worker.ts — reject explicitly instead of
  // giving false confidence that the link is payable right now.
  if (link.expiresAt && link.expiresAt <= new Date()) {
    throw new PaymentLinkStateError("This link's expiry date has passed. Create a new one instead.");
  }

  return prisma.paymentLink.update({ where: { id }, data: { status: "ACTIVE" } });
}