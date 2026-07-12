// lib/circle/payments.ts
//
// Thin wrapper over Circle's Payments API — a DIFFERENT product surface
// from the Developer-Controlled Wallets SDK used everywhere else in this
// codebase (lib/circle/wallets.ts, lib/circle/client.ts). This is what
// lets a payer with no crypto wallet at all pay with a card or bank
// transfer: Circle collects the card/ACH payment, converts it, and
// delivers USDC to a blockchain destination address we specify (our org's
// Arc wallet) — no Circle wallet ID needed on this side, just a
// destination address.
//
// NOTE ON API SHAPE: Circle's Payments API uses REST endpoints separate
// from the Developer-Controlled Wallets SDK, authenticated with the same
// CIRCLE_API_KEY bearer token. This wrapper targets Circle's
// hosted-payment-session flow (payer is redirected to/embeds a
// Circle-hosted card+ACH form; we never touch raw card numbers). If your
// Circle account is provisioned for a different flow (e.g. Circle's own
// tokenization + your own form), adjust buildPaymentRequestBody below —
// this is the one place that request shape is assembled.
//
// Idempotency: every call takes an idempotencyKey and Circle's Payments
// API deduplicates create-payment requests on it the same way
// createTransaction does for wallet sends (see lib/circle/wallets.ts) —
// safe to retry a timed-out request with the same key.

import { getEnv } from "@/lib/env";

export class CirclePaymentsApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CirclePaymentsApiError";
  }
}

const CIRCLE_PAYMENTS_API_BASE = "https://api.circle.com/v1";

export interface CreateHostedCardPaymentInput {
  /** Decimal string, USDC, e.g. "125.50" — the amount the merchant should receive after conversion. */
  amount: string;
  /** Arc address funds should land at once the card/ACH payment settles. */
  destinationAddress: string;
  chain: string;
  idempotencyKey: string;
  payerEmail?: string;
  /** Echoed back on Circle's webhook — this is how app/api/webhooks/circle-payments/route.ts finds the right PaymentLinkPayment with no amount-matching heuristic needed. */
  metadata: { paymentLinkPaymentId: string; paymentLinkId: string };
}

export interface HostedCardPaymentSession {
  circlePaymentId: string;
  /** URL to redirect the payer to (or embed) to complete the card/ACH form. */
  hostedCheckoutUrl: string;
}

/**
 * Creates a hosted card/ACH checkout session. The payer completes payment
 * on Circle's hosted form; Circle later POSTs a webhook
 * (app/api/webhooks/circle-payments/route.ts) once the payment — and its
 * USDC settlement to destinationAddress — completes or fails.
 */
export async function createHostedCardPayment(
  input: CreateHostedCardPaymentInput
): Promise<HostedCardPaymentSession> {
  const env = getEnv();

  const res = await fetch(`${CIRCLE_PAYMENTS_API_BASE}/payments/hostedCheckouts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.CIRCLE_API_KEY}`,
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify(buildPaymentRequestBody(input)),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CirclePaymentsApiError(
      `Circle Payments API returned ${res.status} creating a hosted checkout session`,
      body
    );
  }

  const json = (await res.json()) as {
    data?: { id?: string; hostedUrl?: string };
  };

  const circlePaymentId = json.data?.id;
  const hostedCheckoutUrl = json.data?.hostedUrl;
  if (!circlePaymentId || !hostedCheckoutUrl) {
    throw new CirclePaymentsApiError(
      "Circle Payments API returned no usable payment id / hosted checkout URL"
    );
  }

  return { circlePaymentId, hostedCheckoutUrl };
}

function buildPaymentRequestBody(input: CreateHostedCardPaymentInput): Record<string, unknown> {
  return {
    amount: { amount: input.amount, currency: "USD" },
    settlement: { currency: "USDC", chain: input.chain, destinationAddress: input.destinationAddress },
    payerEmail: input.payerEmail,
    metadata: input.metadata,
  };
}

export interface CirclePaymentStatus {
  circlePaymentId: string;
  status: string; // e.g. pending | confirmed | paid | failed
  settlementTxHash?: string;
  settlementAmount?: string;
  metadata?: { paymentLinkPaymentId?: string; paymentLinkId?: string };
}

/** Fetches current status directly — used as a fallback if a webhook is missed/delayed. */
export async function getPaymentStatus(circlePaymentId: string): Promise<CirclePaymentStatus> {
  const env = getEnv();

  const res = await fetch(`${CIRCLE_PAYMENTS_API_BASE}/payments/${encodeURIComponent(circlePaymentId)}`, {
    headers: { authorization: `Bearer ${env.CIRCLE_API_KEY}` },
  });

  if (!res.ok) {
    throw new CirclePaymentsApiError(`Circle Payments API returned ${res.status} fetching payment status`);
  }

  const json = (await res.json()) as {
    data?: {
      id?: string;
      status?: string;
      settlement?: { txHash?: string; amount?: string };
      metadata?: { paymentLinkPaymentId?: string; paymentLinkId?: string };
    };
  };

  if (!json.data?.id || !json.data?.status) {
    throw new CirclePaymentsApiError(`Malformed payment status response for ${circlePaymentId}`);
  }

  return {
    circlePaymentId: json.data.id,
    status: json.data.status,
    settlementTxHash: json.data.settlement?.txHash,
    settlementAmount: json.data.settlement?.amount,
    metadata: json.data.metadata,
  };
}