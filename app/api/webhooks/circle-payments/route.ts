// app/api/webhooks/circle-payments/route.ts
//
// Ingests Circle Payments API webhooks (the card/ACH payment-link path —
// see lib/circle/payments.ts). Separate endpoint from
// app/api/webhooks/circle/route.ts because this is a different Circle
// product surface with its own event shape, even though both are stored
// in the same WebhookEvent table (source distinguishes them) and verified
// with the same signature scheme.
//
// Unlike the wallet-transfer webhook, there's no amount-matching
// heuristic needed here: Circle echoes back the metadata we set at
// session-creation (paymentLinkPaymentId), so a payment is matched to its
// checkout session unambiguously — see lib/circle/payments.ts's
// CreateHostedCardPaymentInput.metadata.
//
// Order of operations mirrors app/api/webhooks/circle/route.ts: persist
// the raw event unconditionally first, verify signature, then process —
// so a bug in processing can never lose an event, and an unverifiable
// request is stored (for audit) but never acted on.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCircleWebhookSignature } from "@/lib/circle/webhookVerify";
import { toSmallestUnit } from "@/lib/circle/amount";
import { confirmPaymentLinkPayment } from "@/lib/paymentLinks/completion";
import { notifyInvoicePaidIfMatched } from "@/lib/invoices/reconciliation";
import type { Prisma } from "@/app/generated/prisma/client";

interface CirclePaymentWebhookPayload {
  notificationType?: string;
  payment?: {
    id?: string;
    status?: string; // e.g. "confirmed" | "paid" | "failed"
    failureReason?: string;
    settlement?: { txHash?: string; amount?: string; chain?: string };
    metadata?: { paymentLinkPaymentId?: string; paymentLinkId?: string };
  };
}

const SUCCESS_STATUSES = new Set(["paid", "confirmed", "complete", "completed"]);
const FAILURE_STATUSES = new Set(["failed", "declined", "cancelled", "denied"]);

export async function POST(req: Request) {
  const rawBody = await req.text();
  const keyId = req.headers.get("x-circle-key-id");
  const signature = req.headers.get("x-circle-signature");

  const verification = await verifyCircleWebhookSignature(rawBody, keyId, signature);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    parsedPayload = { unparsable: true, raw: rawBody };
  }

  const eventType =
    typeof parsedPayload === "object" && parsedPayload !== null && "notificationType" in parsedPayload
      ? String((parsedPayload as Record<string, unknown>).notificationType)
      : undefined;

  const event = await prisma.webhookEvent.create({
    data: {
      source: "circle-payments",
      eventType,
      signatureOk: verification.ok,
      rawPayload: parsedPayload as never,
      status: "RECEIVED",
    },
  });

  if (!verification.ok) {
    console.warn(`[webhooks/circle-payments] signature verification failed: ${verification.reason}`, {
      webhookEventId: event.id,
    });
    return NextResponse.json({ received: true });
  }

  try {
    await processPaymentEvent(parsedPayload as CirclePaymentWebhookPayload);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (err) {
    console.error(`[webhooks/circle-payments] processing failed for event ${event.id}`, err);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        processError: err instanceof Error ? err.message : "Unknown processing error",
      },
    });
    // Still 200 — the event is durably stored and can be reprocessed;
    // returning non-2xx just causes Circle to retry-storm it.
  }

  return NextResponse.json({ received: true });
}

async function processPaymentEvent(payload: CirclePaymentWebhookPayload): Promise<void> {
  const payment = payload.payment;
  if (!payment?.id || !payment.status) {
    console.warn("[webhooks/circle-payments] event missing payment id/status, skipping", payload);
    return;
  }

  const paymentLinkPaymentId = payment.metadata?.paymentLinkPaymentId;
  if (!paymentLinkPaymentId) {
    console.warn(
      `[webhooks/circle-payments] payment ${payment.id} has no paymentLinkPaymentId in metadata — ` +
        `not one of ours (or a stale/misconfigured session), skipping.`
    );
    return;
  }

  const status = payment.status.toLowerCase();

  if (FAILURE_STATUSES.has(status)) {
    await prisma.paymentLinkPayment.updateMany({
      where: { id: paymentLinkPaymentId, status: "PENDING" }, // idempotent: no-op if already resolved
      data: { status: "FAILED", failureReason: payment.failureReason ?? `Circle reported status "${status}"` },
    });
    return;
  }

  if (!SUCCESS_STATUSES.has(status)) {
    // Non-terminal (e.g. "pending", "processing") — nothing to do yet;
    // Circle will send another webhook once it reaches a terminal state.
    return;
  }

  const session = await prisma.paymentLinkPayment.findUnique({
    where: { id: paymentLinkPaymentId },
    include: { paymentLink: { include: { organization: { include: { wallets: { take: 1 } } } } } },
  });
  if (!session) {
    console.error(`[webhooks/circle-payments] payment ${payment.id} references unknown session ${paymentLinkPaymentId}`);
    return;
  }
  if (session.status !== "PENDING") {
    return; // already processed — redelivered webhook, no-op
  }

  const wallet = session.paymentLink.organization.wallets[0];
  if (!wallet) {
    console.error(
      `[webhooks/circle-payments] org ${session.paymentLink.orgId} has no wallet — cannot settle payment ${payment.id}`
    );
    return;
  }

  const settledAmountRaw = payment.settlement?.amount;
  const amountPaid = settledAmountRaw ? toSmallestUnit(settledAmountRaw) : session.amountExpected;

  const reconciliation = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // The card/ACH payment settles as a real USDC deposit to the org's Arc
    // wallet — recorded as an inbound OnchainTransaction, exactly like a
    // wallet-originated transfer, so the wallet balance / ledger
    // reconciliation story (jobs/workers/reconciliation.worker.ts) stays
    // uniform regardless of which checkout method the payer used.
    const onchainTx = await tx.onchainTransaction.create({
      data: {
        walletId: wallet.id,
        direction: "IN",
        amount: amountPaid,
        counterpartyAddress: session.payerIdentifier ?? "circle-payments-api",
        chain: wallet.chain,
        sourceChain: wallet.chain,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        txHash: payment.settlement?.txHash,
        circleTransactionId: `circle-payment-${payment.id}`,
        memo: `Card/bank payment via payment link checkout session ${session.id}`,
      },
    });

    const result = await confirmPaymentLinkPayment(tx, {
      paymentLinkPaymentId: session.id,
      onchainTransactionId: onchainTx.id,
      amountPaid,
    });

    return { matched: true, invoiceId: result.invoiceId };
  });

  await notifyInvoicePaidIfMatched(session.paymentLink.orgId, reconciliation);
}