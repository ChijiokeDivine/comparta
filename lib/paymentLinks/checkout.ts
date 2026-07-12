// lib/paymentLinks/checkout.ts
//
// Public, unauthenticated checkout flow for /pay/[slug]. Three entry
// points, mirroring lib/invoices/service.ts's public/private split:
//   - getPublicPaymentLink(slug)   -> what the checkout page renders
//   - startWalletCheckout(...)     -> "pay from an existing wallet" path
//   - startCardCheckout(...)       -> "pay with card/bank" path (Circle
//                                      Payments API)
//
// Both start*Checkout functions create a PENDING PaymentLinkPayment row
// BEFORE any money moves — this is the correlation anchor the two
// settlement paths use to close the loop (see lib/paymentLinks/
// reconciliation.ts for the wallet path, app/api/webhooks/circle-payments/
// route.ts for the card path).

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { createHostedCardPayment } from "@/lib/circle/payments";
import type { PaymentLink } from "@/app/generated/prisma/client";

export class PaymentLinkNotPayableError extends Error {
  constructor(message: string, public readonly code: PaymentLinkNotPayableCode) {
    super(message);
    this.name = "PaymentLinkNotPayableError";
  }
}

export type PaymentLinkNotPayableCode = "NOT_FOUND" | "PAUSED" | "EXPIRED" | "USED_UP";

export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutValidationError";
  }
}

// Minimum for an open-amount payer-entered amount — same floor as
// payment link creation, prevents a $0.00/negative "payment".
const MIN_AMOUNT_SMALLEST_UNIT = 1n;

export interface PublicPaymentLinkView {
  id: string;
  slug: string;
  orgLegalName: string;
  description: string | null;
  type: "FIXED_AMOUNT" | "OPEN_AMOUNT";
  amount: string | null; // decimal string; null for OPEN_AMOUNT
  payable: boolean;
  unavailableReason: PaymentLinkNotPayableCode | null;
}

/**
 * Loads the checkout page's data. Never throws for an unpayable link
 * (paused/expired/used-up/not-found) — those are ordinary states the
 * checkout page renders a friendly message for, not an error condition.
 * Only genuinely malformed input (nonexistent slug format issues aren't a
 * thing — slugs are opaque) or infra failures throw.
 *
 * Lazily flips a time-expired ACTIVE link to EXPIRED on read, same
 * self-healing pattern as lib/invoices/service.ts#recordInvoiceViewed —
 * the periodic sweep (jobs/paymentLinkExpiry.worker.ts) exists for links
 * nobody ever visits again, not as the only mechanism.
 */
export async function getPublicPaymentLink(slug: string): Promise<PublicPaymentLinkView> {
  const link = await prisma.paymentLink.findUnique({
    where: { slug },
    include: { organization: { select: { legalName: true } } },
  });

  if (!link) {
    return {
      id: "",
      slug,
      orgLegalName: "",
      description: null,
      type: "FIXED_AMOUNT",
      amount: null,
      payable: false,
      unavailableReason: "NOT_FOUND",
    };
  }

  const effectiveStatus = await lazilyExpireIfNeeded(link);

  const unavailableReason: PaymentLinkNotPayableCode | null =
    effectiveStatus === "PAUSED"
      ? "PAUSED"
      : effectiveStatus === "EXPIRED"
        ? "EXPIRED"
        : link.maxUses !== null && link.useCount >= link.maxUses
          ? "USED_UP"
          : null;

  return {
    id: link.id,
    slug: link.slug,
    orgLegalName: link.organization.legalName,
    description: link.description,
    type: link.type,
    amount: link.amount !== null ? toDecimalString(link.amount) : null,
    payable: unavailableReason === null,
    unavailableReason,
  };
}

async function lazilyExpireIfNeeded(link: PaymentLink): Promise<PaymentLink["status"]> {
  if (link.status !== "ACTIVE") return link.status;
  const timeExpired = link.expiresAt !== null && link.expiresAt <= new Date();
  if (!timeExpired) return link.status;

  await prisma.paymentLink.update({ where: { id: link.id }, data: { status: "EXPIRED" } }).catch(() => {
    // Best-effort — a concurrent request may have already flipped it, or
    // the sweep job beat us to it. Either way the caller treats it as
    // expired regardless of whether this particular write landed.
  });
  return "EXPIRED";
}

/** Shared payability + amount-resolution logic for both checkout-start paths. */
async function loadPayableLink(slug: string, amountInput: string | undefined): Promise<{ link: PaymentLink; amountExpected: bigint }> {
  const link = await prisma.paymentLink.findUnique({ where: { slug } });
  if (!link) throw new PaymentLinkNotPayableError("This payment link doesn't exist.", "NOT_FOUND");

  const status = await lazilyExpireIfNeeded(link);
  if (status === "PAUSED") {
    throw new PaymentLinkNotPayableError("This payment link isn't accepting payments right now.", "PAUSED");
  }
  if (status === "EXPIRED") {
    throw new PaymentLinkNotPayableError("This payment link has expired.", "EXPIRED");
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    throw new PaymentLinkNotPayableError("This payment link has already been used.", "USED_UP");
  }

  if (link.type === "FIXED_AMOUNT") {
    // amount is guaranteed non-null for FIXED_AMOUNT by createPaymentLink's
    // validation — non-null assertion documents that invariant rather
    // than silently coalescing.
    return { link, amountExpected: link.amount! };
  }

  // OPEN_AMOUNT: payer supplies the amount, validated here — this is the
  // "payer enters $0 or a negative number" edge case from the spec.
  if (!amountInput || !amountInput.trim()) {
    throw new CheckoutValidationError("Enter an amount to pay.");
  }
  let smallest: bigint;
  try {
    smallest = toSmallestUnit(amountInput);
  } catch {
    throw new CheckoutValidationError(`"${amountInput}" isn't a valid USDC amount.`);
  }
  if (smallest < MIN_AMOUNT_SMALLEST_UNIT) {
    throw new CheckoutValidationError("Amount must be greater than zero.");
  }
  return { link, amountExpected: smallest };
}

export interface StartWalletCheckoutInput {
  slug: string;
  /** Required for OPEN_AMOUNT links; ignored (link.amount is authoritative) for FIXED_AMOUNT. */
  amount?: string;
  /** Optional — the payer's wallet address, if the client already knows it pre-signature. */
  payerIdentifier?: string;
}

export interface WalletCheckoutSession {
  paymentLinkPaymentId: string;
  payToAddress: string;
  chain: string;
  amountExpected: string; // decimal string
}

export async function startWalletCheckout(input: StartWalletCheckoutInput): Promise<WalletCheckoutSession> {
  const { link, amountExpected } = await loadPayableLink(input.slug, input.amount);

  const wallet = await prisma.wallet.findFirst({ where: { orgId: link.orgId } });
  if (!wallet) {
    throw new PaymentLinkNotPayableError(
      "This merchant's wallet isn't set up yet — try again later.",
      "NOT_FOUND"
    );
  }

  const session = await prisma.paymentLinkPayment.create({
    data: {
      paymentLinkId: link.id,
      method: "WALLET",
      amountExpected,
      payerIdentifier: input.payerIdentifier?.trim() || null,
      status: "PENDING",
    },
  });

  return {
    paymentLinkPaymentId: session.id,
    payToAddress: wallet.arcAddress,
    chain: wallet.chain,
    amountExpected: toDecimalString(amountExpected),
  };
}

export interface StartCardCheckoutInput {
  slug: string;
  amount?: string;
  payerEmail?: string;
}

export interface CardCheckoutSession {
  paymentLinkPaymentId: string;
  circlePaymentId: string;
  hostedCheckoutUrl: string;
  amountExpected: string;
}

/**
 * Starts the card/bank path: reserves a PaymentLinkPayment row, then asks
 * Circle's Payments API for a hosted checkout session that ultimately
 * settles as USDC into this org's Arc wallet. Idempotency here is on
 * PaymentLinkPayment.id itself (generated server-side, one per attempt) —
 * every retry from a slow/flaky client is a fresh session by design,
 * exactly like abandoning a checkout tab and reopening it.
 */
export async function startCardCheckout(input: StartCardCheckoutInput): Promise<CardCheckoutSession> {
  const { link, amountExpected } = await loadPayableLink(input.slug, input.amount);

  const wallet = await prisma.wallet.findFirst({ where: { orgId: link.orgId } });
  if (!wallet) {
    throw new PaymentLinkNotPayableError(
      "This merchant's wallet isn't set up yet — try again later.",
      "NOT_FOUND"
    );
  }

  const session = await prisma.paymentLinkPayment.create({
    data: {
      paymentLinkId: link.id,
      method: "CARD",
      amountExpected,
      payerIdentifier: input.payerEmail?.trim().toLowerCase() || null,
      status: "PENDING",
    },
  });

  const idempotencyKey = randomUUID();

  try {
    const circlePayment = await createHostedCardPayment({
      amount: toDecimalString(amountExpected),
      destinationAddress: wallet.arcAddress,
      chain: wallet.chain,
      idempotencyKey,
      payerEmail: input.payerEmail,
      metadata: { paymentLinkPaymentId: session.id, paymentLinkId: link.id },
    });

    await prisma.paymentLinkPayment.update({
      where: { id: session.id },
      data: { circlePaymentId: circlePayment.circlePaymentId, idempotencyKey },
    });

    return {
      paymentLinkPaymentId: session.id,
      circlePaymentId: circlePayment.circlePaymentId,
      hostedCheckoutUrl: circlePayment.hostedCheckoutUrl,
      amountExpected: toDecimalString(amountExpected),
    };
  } catch (err) {
    await prisma.paymentLinkPayment.update({
      where: { id: session.id },
      data: { status: "FAILED", failureReason: "Failed to start card/bank checkout with Circle." },
    });
    console.error(`[paymentLinks] Circle Payments API session creation failed for ${session.id}`, err);
    throw err;
  }
}