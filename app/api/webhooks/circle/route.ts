// app/api/webhooks/circle/route.ts
//
// Ingests Circle's webhook notifications (wallet transactions, challenge
// status changes, etc). Order of operations matters here:
//
//   1. Read the RAW body (needed byte-for-byte for signature verification)
//   2. Verify X-Circle-Signature against Circle's published public key
//   3. Persist the raw payload to WebhookEvent UNCONDITIONALLY, before any
//      processing - so a bug in step 4 can never lose an event. Even
//      requests that fail signature verification are stored (with
//      signatureOk: false) for audit/debugging, but are never processed.
//   4. Process, dispatching on notificationType:
//        - "transactions.inbound"  -> checked first against
//          PaymentLinkPayment.depositAddress (lib/paymentLinks/
//          reconciliation.ts#reconcileDepositWalletPayment - payment-link
//          wallet-checkout deposits); otherwise lib/transfers/receive.ts
//          (credits the receiving org's ledger)
//        - "transactions.outbound" -> jobs/confirmTransaction.ts's
//          confirmTransaction(), so an outbound send resolves as soon as
//          the webhook arrives rather than waiting for the next poll
//        - anything else -> logged and marked processed, no-op
//
// Circle expects a 200 response quickly; heavier processing being done
// inline here is acceptable for now given Comparta's volume, but should
// move to a queue (see jobs/queue.ts) if webhook processing ever becomes
// a latency bottleneck.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCircleWebhookSignature } from "@/lib/circle/webhookVerify";
import { handleInboundTransfer, type InboundNotification } from "@/lib/transfers/receive";
import { confirmTransaction } from "@/jobs/confirmTransaction";
import { reconcileDepositWalletPayment } from "@/lib/paymentLinks/reconciliation";
import { toSmallestUnit } from "@/lib/circle/amount";
import { confirmPaymentLinkPayment } from "@/lib/paymentLinks/completion";

interface CircleWebhookPayload {
  subscriptionId?: string;
  notificationId?: string;
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
  timestamp?: string;
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

  // Always write the raw event first - this is the "never lose an event"
  // guarantee, independent of whether it verifies or how processing goes.
  const event = await prisma.webhookEvent.create({
    data: {
      source: "circle",
      eventType,
      signatureOk: verification.ok,
      rawPayload: parsedPayload as never,
      status: "RECEIVED",
    },
  });

  if (!verification.ok) {
    console.warn(`[webhooks/circle] signature verification failed: ${verification.reason}`, {
      webhookEventId: event.id,
    });
    // Still 200 - Circle doesn't need to retry an unverifiable request,
    // and we don't want to leak *why* verification failed to a caller
    // that might be forging requests.
    return NextResponse.json({ received: true });
  }

  try {
    await dispatchNotification(eventType, parsedPayload as CircleWebhookPayload);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (err) {
    console.error(`[webhooks/circle] processing failed for event ${event.id}`, err);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        processError: err instanceof Error ? err.message : "Unknown processing error",
      },
    });
    // Still return 200: we've durably stored the event and can reprocess
    // it later from WebhookEvent. Returning a 4xx/5xx here just causes
    // Circle to retry-storm an event we already have safely on disk.
  }

  return NextResponse.json({ received: true });
}

async function dispatchNotification(
  eventType: string | undefined,
  payload: CircleWebhookPayload
): Promise<void> {
  const notification = payload.notification;

  switch (eventType) {
    case "transactions.inbound": {
      if (!notification?.id || !notification.walletId || !notification.blockchain || !notification.amounts) {
        console.warn("[webhooks/circle] inbound notification missing required fields, skipping", payload);
        return;
      }

      // Payment-link wallet-checkout deposits land at a single-purpose
      // Circle wallet (lib/circle/wallets.ts#createWalletForPaymentLinkPayment)
      // that's never registered in the Wallet table - this MUST be
      // checked, and handled separately, before falling through to
      // handleInboundTransfer below, which resolves org treasury wallets
      // from that table and isn't meant for these.
      if (notification.destinationAddress) {
        const depositMatch = await prisma.paymentLinkPayment.findUnique({
          where: { depositAddress: notification.destinationAddress },
          select: { id: true },
        });
        if (depositMatch) {
          if (!notification.amounts[0]) {
            console.warn("[webhooks/circle] deposit-wallet inbound notification missing amount, skipping", payload);
            return;
          }
          await reconcileDepositWalletPayment({
            depositAddress: notification.destinationAddress,
            amountReceived: toSmallestUnit(notification.amounts[0]),
          });
          return;
        }
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
      return;
    }

    case "transactions.outbound": {
      if (!notification?.id) return;

      // Existing path: our OnchainTransaction rows keyed by circleTransactionId
      const onchainTx = await prisma.onchainTransaction.findFirst({
        where: { circleTransactionId: notification.id },
        select: { id: true },
      });
      if (onchainTx) {
        await confirmTransaction(onchainTx.id);
        return;
      }

      // Recovery: deposit-wallet sweep completed on-chain but confirmPaymentLinkPayment
      // never committed (session left in SWEEPING after a successful sendTransaction).
      if (
        notification.state === "COMPLETE" &&
        notification.walletId &&
        notification.sourceAddress
      ) {
        const stuck = await prisma.paymentLinkPayment.findFirst({
          where: {
            depositWalletId: notification.walletId,
            status: "SWEEPING",
          },
          include: {
            paymentLink: {
              include: { organization: { include: { wallets: { take: 1 } } } },
            },
          },
        });

        if (stuck?.paymentLink.organization.wallets[0]) {
          const treasury = stuck.paymentLink.organization.wallets[0];
          const amount = stuck.amountExpected;

          await prisma.$transaction(async (tx) => {
            let onchainTxId: string;
            const existing = await tx.onchainTransaction.findFirst({
              where: {
                OR: [
                  { circleTransactionId: notification.id },
                  { txHash: notification.txHash ?? notification.id },
                ],
              },
              select: { id: true },
            });

            if (existing) {
              onchainTxId = existing.id;
            } else {
              const created = await tx.onchainTransaction.create({
                data: {
                  walletId: treasury.id,
                  direction: "IN",
                  amount,
                  counterpartyAddress: stuck.depositAddress!,
                  chain: treasury.chain,
                  status: "CONFIRMED",
                  confirmedAt: new Date(),
                  txHash: notification.txHash ?? notification.id,
                  circleTransactionId: notification.id,
                  memo: `Recovered sweep from payment-link deposit wallet ${stuck.depositAddress} for session ${stuck.id}`,
                },
              });
              onchainTxId = created.id;
            }

            await confirmPaymentLinkPayment(tx, {
              paymentLinkPaymentId: stuck.id,
              onchainTransactionId: onchainTxId,
              amountPaid: amount,
            });
          });

          const { broadcastPaymentLinkSessionUpdate, broadcastPaymentReceived } =
            await import("@/lib/realtime/eventBus");
          const { toDecimalString } = await import("@/lib/circle/amount");

          broadcastPaymentLinkSessionUpdate({
            type: "payment_link_session_update",
            paymentLinkPaymentId: stuck.id,
            status: "CONFIRMED",
            amountPaid: toDecimalString(amount),
          });
          broadcastPaymentReceived({
            type: "payment_received",
            orgId: stuck.paymentLink.orgId,
            amount: toDecimalString(amount),
            counterpartyAddress: stuck.depositAddress ?? "",
            onchainTransactionId: stuck.id,
            createdAt: new Date().toISOString(),
          });

          console.log(
            `[webhooks/circle] recovered stuck SWEEPING session ${stuck.id} via outbound webhook`
          );
        }
      }
      return;
    }

    default:
      console.log(`[webhooks/circle] received event ${eventType ?? "unknown"} - no handler, ignoring`);
      return;
  }
}