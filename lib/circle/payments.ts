// lib/circle/payments.ts
//
// Thin wrapper over Circle's Payments API - a DIFFERENT product surface
// from the Developer-Controlled Wallets SDK used everywhere else in this
// codebase (lib/circle/wallets.ts, lib/circle/client.ts). This is what
// lets a payer with no crypto wallet at all pay with a card or bank
// transfer: Circle collects the card/ACH payment, converts it, and
// delivers USDC to a blockchain destination address we specify (our org's
// Arc wallet) - no Circle wallet ID needed on this side, just a
// destination address.
//
// NOTE ON API SHAPE: Circle's Payments API uses REST endpoints separate
// from the Developer-Controlled Wallets SDK, authenticated with the same
// CIRCLE_API_KEY bearer token. This wrapper targets Circle's
// hosted-payment-session flow (payer is redirected to/embeds a
// Circle-hosted card+ACH form; we never touch raw card numbers). If your
// Circle account is provisioned for a different flow (e.g. Circle's own
// tokenization + your own form), adjust buildPaymentRequestBody below -
// this is the one place that request shape is assembled.
//
// Idempotency: every call takes an idempotencyKey and Circle's Payments
// API deduplicates create-payment requests on it the same way
// createTransaction does for wallet sends (see lib/circle/wallets.ts) -
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
  /** Decimal string, USDC, e.g. "125.50" - the amount the merchant should receive after conversion. */
  amount: string;
  /** Arc address funds should land at once the card/ACH payment settles. */
  destinationAddress: string;
  chain: string;
  idempotencyKey: string;
  payerEmail?: string;
  /** Echoed back on Circle's webhook - this is how app/api/webhooks/circle-payments/route.ts finds the right PaymentLinkPayment with no amount-matching heuristic needed. */
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
 * (app/api/webhooks/circle-payments/route.ts) once the payment - and its
 * USDC settlement to destinationAddress - completes or fails.
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

// ─────────────────────────────────────────────────────────────────────────
// Crypto Payment Intents (Stablecoin Payins) - a different resource on this
// same Payments API surface: POST /v1/paymentIntents. Used by the wallet
// checkout path (lib/paymentLinks/checkout.ts#startWalletCheckout) instead
// of pointing the payer straight at the org's Arc treasury address: a
// "transient" intent (as opposed to Circle's default "continuous" one) is
// created for one exact amount, gets exactly one one-time deposit address,
// and is done once that address is paid or the intent expires - which is
// what gives this path Circle-verified exact-amount matching instead of the
// heuristic in lib/paymentLinks/reconciliation.ts.
//
// Request/response shape and the webhook envelope consumed in
// app/api/webhooks/circle/route.ts are taken from Circle's public API
// reference (developers.circle.com/api-reference/circle-mint/payments/
// create-payment-intent and .../circle-mint/references/webhook-notifications)
// - this is a newer, more specialized surface than the hosted-checkout flow
// above, so re-check those docs if requests start failing.

export interface CreateTransientPaymentIntentInput {
  /** Decimal string, USDC, e.g. "125.50" - the exact amount this intent will accept. */
  amount: string;
  /** The merchant's Circle wallet (Wallet.circleWalletId) - funds are swept here once the deposit address is paid. Never exposed to the payer; only the generated address is. */
  merchantWalletId: string;
  /**
   * Circle's chain identifier for the Payment Intents API (e.g. "ARC" -
   * sandbox-only per Circle's docs). NOTE: this is a different naming
   * scheme from the app's internal Chain enum on Wallet.chain (e.g.
   * "ARC_TESTNET") - passed straight through here with no translation
   * layer, same pre-existing gap as chain in createHostedCardPayment above.
   */
  chain: string;
  idempotencyKey: string;
}

export interface TransientPaymentIntent {
  circlePaymentIntentId: string;
  /** One-time deposit address Circle generated for this intent - safe to show the payer, unlike merchantWalletId's underlying treasury address. */
  address: string;
  chain: string;
  expiresAt?: string;
}

/**
 * Creates a transient Payment Intent for an exact amount, tied to the
 * merchant's Circle wallet. Circle assigns the deposit address synchronously
 * in the create response - no need to wait on a webhook just to learn where
 * the payer should send funds.
 */
export async function createTransientPaymentIntent(
  input: CreateTransientPaymentIntentInput
): Promise<TransientPaymentIntent> {
  const env = getEnv();

  const res = await fetch(`${CIRCLE_PAYMENTS_API_BASE}/paymentIntents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify(buildPaymentIntentRequestBody(input)),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CirclePaymentsApiError(
      `Circle Payment Intents API returned ${res.status} creating a transient payment intent`,
      body
    );
  }

  const json = (await res.json()) as {
    data?: {
      id?: string;
      paymentMethods?: Array<{ type?: string; chain?: string; address?: string }>;
      expiresOn?: string;
    };
  };

  const circlePaymentIntentId = json.data?.id;
  const blockchainMethod = json.data?.paymentMethods?.find((m) => m.type === "blockchain");
  const address = blockchainMethod?.address;

  if (!circlePaymentIntentId || !address) {
    throw new CirclePaymentsApiError(
      "Circle Payment Intents API returned no usable payment intent id / deposit address"
    );
  }

  return {
    circlePaymentIntentId,
    address,
    chain: blockchainMethod?.chain ?? input.chain,
    expiresAt: json.data?.expiresOn,
  };
}

// Per Circle's documented schema for this endpoint, amount/settlementCurrency
// are "USD"/"EUR" enums even though settlement itself is USDC on Arc - this
// deliberately differs from buildPaymentRequestBody above (a different
// product/endpoint with its own documented request shape), not an
// inconsistency to reconcile.
function buildPaymentIntentRequestBody(input: CreateTransientPaymentIntentInput): Record<string, unknown> {
  return {
    idempotencyKey: input.idempotencyKey,
    type: "transient",
    amount: { amount: input.amount, currency: "USD" },
    settlementCurrency: "USD",
    paymentMethods: [{ type: "blockchain", chain: input.chain }],
    merchantWalletId: input.merchantWalletId,
  };
}

/** Fetches current status directly - used as a fallback if a webhook is missed/delayed. */
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