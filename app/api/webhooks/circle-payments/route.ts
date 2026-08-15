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
//
// MISROUTING GUARD: in practice, a Circle webhook subscription can end up
// configured to send `transactions.inbound` (plain wallet-transfer)
// notifications to THIS endpoint instead of app/api/webhooks/circle —
// that's a subscription-config problem on Circle's side, not something
// this code controls. Left unguarded, that payload has no `payment` key,
// so processPaymentEvent's `if (!payment?.id...)` check would silently
// return and the event gets marked PROCESSED despite nothing having
// happened — a real deposit landing in the wallet with no ledger credit
// and no error anywhere. Detect that shape up front and delegate to the
// same handleInboundTransfer() that app/api/webhooks/circle/route.ts
// uses, so this endpoint is correct regardless of which URL Circle
// actually targets.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCircleWebhookSignature } from "@/lib/circle/webhookVerify";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { confirmPaymentLinkPayment } from "@/lib/paymentLinks/completion";
import { notifyInvoicePaidIfMatched } from "@/lib/invoices/reconciliation";
import { handleInboundTransfer, type InboundNotification } from "@/lib/transfers/receive";
import { broadcastPaymentReceived } from "@/lib/realtime/eventBus";
import type { Prisma } from "@/app/generated/prisma/client";

interface CircleWalletTransferPayload {
  notificationType?: string;
  notification?: {
    id?: string;
    blockchain?: string;
    sourceBlockchain?: string;
    walletId?: string;
    destinationAddress?: string;
    sourceAddress?: string;
    tokenId?: string;
    amounts?: string[];
    state?: string;
    status?: string;
    txHash?: string;
  };
}

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

/**
 * A wallet-transfer notification (transactions.inbound/outbound, or
 * anything else carrying Circle's `notification` envelope) has no
 * `payment` key at all — that's the one reliable signal that this
 * payload was meant for app/api/webhooks/circle/route.ts, not this file.
 */
function isWalletTransferPayload(payload: unknown): payload is CircleWalletTransferPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const obj = payload as Record<string, unknown>;
  return "notification" in obj && !("payment" in obj);
}

async function dispatchMisroutedWalletTransfer(payload: CircleWalletTransferPayload): Promise<void> {
  const notification = payload.notification;
  if (payload.notificationType !== "transactions.inbound" || !notification) {
    // Not an inbound-credit event (e.g. transactions.outbound, or a type
    // this endpoint has no business acting on) — log and move on rather
    // than guessing at handling it here.
    console.warn(
      `[webhooks/circle-payments] received misrouted non-inbound wallet notification ` +
        `(${payload.notificationType ?? "unknown type"}) — ignoring. Check the Circle webhook ` +
        `subscription config; this belongs on /api/webhooks/circle.`
    );
    return;
  }
  if (!notification.id || !notification.walletId || !notification.blockchain || !notification.amounts) {
    console.warn("[webhooks/circle-payments] misrouted inbound notification missing required fields, skipping", payload);
    return;
  }

  const inbound: InboundNotification = {
    circleTransactionId: notification.id,
    walletId: notification.walletId,
    tokenId: notification.tokenId,
    blockchain: notification.blockchain,
    sourceBlockchain: notification.sourceBlockchain,
    destinationAddress: notification.destinationAddress ?? "",
    sourceAddress: notification.sourceAddress,
    amounts: notification.amounts,
    state: notification.state ?? notification.status ?? "UNKNOWN",
    txHash: notification.txHash,
    rawPayload: payload,
  };
  await handleInboundTransfer(inbound);
}

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
    if (isWalletTransferPayload(parsedPayload)) {
      await dispatchMisroutedWalletTransfer(parsedPayload);
    } else {
      await processPaymentEvent(parsedPayload as CirclePaymentWebhookPayload);
    }
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

  try {
    broadcastPaymentReceived({
      type: "payment_received",
      orgId: session.paymentLink.orgId,
      amount: toDecimalString(amountPaid),
      counterpartyAddress: session.payerIdentifier ?? "circle-payments-api",
      onchainTransactionId: `circle-payment-${payment.id}`,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[webhooks/circle-payments] failed to broadcast payment_received", err);
  }
}