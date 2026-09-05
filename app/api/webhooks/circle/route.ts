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
//          the webhook arrives rather than waiting for the next poll.
//          Also recovers deposit-wallet sweeps that completed on-chain but
//          left PaymentLinkPayment stuck in SWEEPING.
//        - anything else -> logged and marked processed, no-op

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCircleWebhookSignature } from "@/lib/circle/webhookVerify";
import { handleInboundTransfer, type InboundNotification } from "@/lib/transfers/receive";
import { confirmTransaction } from "@/jobs/confirmTransaction";
import { reconcileDepositWalletPayment } from "@/lib/paymentLinks/reconciliation";
import { confirmPaymentLinkPayment } from "@/lib/paymentLinks/completion";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import {
  broadcastPaymentLinkSessionUpdate,
  broadcastPaymentReceived,
} from "@/lib/realtime/eventBus";

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

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
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
    typeof parsedPayload === "object" &&
    parsedPayload !== null &&
    "notificationType" in parsedPayload
      ? String((parsedPayload as Record<string, unknown>).notificationType)
      : undefined;

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
      if (
        !notification?.id ||
        !notification.walletId ||
        !notification.blockchain ||
        !notification.amounts
      ) {
        console.warn(
          "[webhooks/circle] inbound notification missing required fields, skipping",
          payload
        );
        return;
      }

      if (notification.destinationAddress) {
        // Case-insensitive match: Circle and our stored depositAddress may differ in checksum casing
        const dest = notification.destinationAddress.toLowerCase();
        const depositMatch = await prisma.paymentLinkPayment.findFirst({
          where: {
            depositAddress: { equals: dest, mode: "insensitive" },
          },
          select: { id: true, depositAddress: true },
        });

        if (depositMatch) {
          if (!notification.amounts[0]) {
            console.warn(
              "[webhooks/circle] deposit-wallet inbound notification missing amount, skipping",
              payload
            );
            return;
          }
          await reconcileDepositWalletPayment({
            depositAddress: depositMatch.depositAddress!,
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

      const onchainTx = await prisma.onchainTransaction.findFirst({
        where: {
          OR: [
            { circleTransactionId: notification.id },
            ...(notification.txHash ? [{ txHash: notification.txHash }] : []),
          ],
        },
        select: { id: true },
      });
      if (onchainTx) {
        await confirmTransaction(onchainTx.id);
      }

      // Recovery: deposit-wallet sweep completed on-chain but session left SWEEPING
      const state = (notification.state ?? notification.status ?? "").toUpperCase();
      if ((state === "COMPLETE" || state === "CONFIRMED") && notification.walletId) {
        const stuck = await prisma.paymentLinkPayment.findFirst({
          where: {
            depositWalletId: notification.walletId,
            status: "SWEEPING",
          },
          include: {
            paymentLink: {
              include: {
                organization: { include: { wallets: { take: 1 } } },
              },
            },
          },
        });

        if (stuck?.paymentLink.organization.wallets[0]) {
          const treasury = stuck.paymentLink.organization.wallets[0];
          const amount = stuck.amountExpected;
          const txHash = notification.txHash ?? notification.id;

          try {
            await prisma.$transaction(async (tx) => {
              let existing = await tx.onchainTransaction.findFirst({
                where: {
                  OR: [
                    { circleTransactionId: notification.id },
                    { txHash },
                  ],
                },
                select: { id: true },
              });

              let onchainTxId: string;

              if (existing) {
                onchainTxId = existing.id;
              } else {
                try {
                  const created = await tx.onchainTransaction.create({
                    data: {
                      walletId: treasury.id,
                      direction: "IN",
                      amount,
                      counterpartyAddress: stuck.depositAddress!,
                      chain: treasury.chain,
                      status: "CONFIRMED",
                      confirmedAt: new Date(),
                      txHash,
                      circleTransactionId: notification.id,
                      memo: `Recovered sweep from deposit wallet for session ${stuck.id}`,
                    },
                  });
                  onchainTxId = created.id;
                } catch (err) {
                  // Row already exists (race / prior partial write)
                  if (!isPrismaUniqueViolation(err)) throw err;
                  existing = await tx.onchainTransaction.findFirst({
                    where: {
                      OR: [
                        { circleTransactionId: notification.id },
                        { txHash },
                      ],
                    },
                    select: { id: true },
                  });
                  if (!existing) throw err;
                  onchainTxId = existing.id;
                }
              }

              // Idempotent: only confirm if still SWEEPING
              const stillStuck = await tx.paymentLinkPayment.findFirst({
                where: { id: stuck.id, status: "SWEEPING" },
                select: { id: true },
              });
              if (!stillStuck) return;

              await confirmPaymentLinkPayment(tx, {
                paymentLinkPaymentId: stuck.id,
                onchainTransactionId: onchainTxId,
                amountPaid: amount,
              });
            });

            try {
              broadcastPaymentLinkSessionUpdate({
                type: "payment_link_session_update",
                paymentLinkPaymentId: stuck.id,
                status: "CONFIRMED",
                amountPaid: toDecimalString(amount),
              });
            } catch (err) {
              console.error(
                "[webhooks/circle] failed to broadcast session update after recovery",
                err
              );
            }

            try {
              broadcastPaymentReceived({
                type: "payment_received",
                orgId: stuck.paymentLink.orgId,
                amount: toDecimalString(amount),
                counterpartyAddress: stuck.depositAddress ?? "",
                onchainTransactionId: stuck.id,
                createdAt: new Date().toISOString(),
              });
            } catch (err) {
              console.error(
                "[webhooks/circle] failed to broadcast payment_received after recovery",
                err
              );
            }

            console.log(
              `[webhooks/circle] recovered SWEEPING session ${stuck.id} via outbound`
            );
          } catch (err) {
            console.error(
              `[webhooks/circle] failed to recover SWEEPING session ${stuck.id}`,
              err
            );
          }
        }
      }
      return;
    }

    default:
      console.log(
        `[webhooks/circle] received event ${eventType ?? "unknown"} - no handler, ignoring`
      );
      return;
  }
}