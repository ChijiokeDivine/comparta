// app/api/webhooks/circle/route.ts
//
// Ingests Circle wallet transaction webhooks.
//
// Order of operations:
//   1. Read RAW body (signature verification is byte-sensitive)
//   2. Verify X-Circle-Signature
//   3. Persist WebhookEvent unconditionally (never lose an event)
//   4. Dispatch:
//        - transactions.inbound  → deposit-wallet payment-link path first,
//          else treasury receive path
//        - transactions.outbound → confirm known OnchainTransactions; also
//          recover payment-link sessions left in SWEEPING after a successful
//          on-chain sweep whose confirm step failed
//
// Money safety rules in this file:
//   - Deposit wallets are never treated as treasury wallets
//   - Confirm is idempotent: only SWEEPING → CONFIRMED; ledger uses
//     (ONCHAIN_TX, onchainTxId) as reference so retries cannot double-credit
//   - OnchainTransaction find-or-create is OUTSIDE the confirm transaction
//     so a unique-constraint collision never aborts the confirm tx (25P02)
//   - Always return 200 after durable storage so Circle does not retry-storm

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

      // Payment-link deposit wallets are not in the Wallet table. Match by
      // depositAddress (case-insensitive) BEFORE treasury receive handling.
      if (notification.destinationAddress) {
        const depositMatch = await prisma.paymentLinkPayment.findFirst({
          where: {
            depositAddress: {
              equals: notification.destinationAddress,
              mode: "insensitive",
            },
          },
          select: { id: true, depositAddress: true },
        });

        if (depositMatch?.depositAddress) {
          if (!notification.amounts[0]) {
            console.warn(
              "[webhooks/circle] deposit-wallet inbound missing amount, skipping",
              payload
            );
            return;
          }
          await reconcileDepositWalletPayment({
            depositAddress: depositMatch.depositAddress,
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

      // Confirm any outbound we already tracked (treasury sends, etc.)
      const tracked = await prisma.onchainTransaction.findFirst({
        where: {
          OR: [
            { circleTransactionId: notification.id },
            ...(notification.txHash ? [{ txHash: notification.txHash }] : []),
          ],
        },
        select: { id: true },
      });
      if (tracked) {
        await confirmTransaction(tracked.id);
      }

      // Recover payment-link sessions stuck in SWEEPING after a successful
      // on-chain sweep whose confirm step previously failed.
      const state = (notification.state ?? notification.status ?? "").toUpperCase();
      if (
        (state === "COMPLETE" || state === "CONFIRMED") &&
        notification.walletId
      ) {
        await recoverStuckDepositSweep(notification);
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

/**
 * If a deposit-wallet outbound completed but PaymentLinkPayment is still
 * SWEEPING, finish confirmation exactly once.
 *
 * Money safety:
 * - amountPaid is always session.amountExpected (never webhook amounts[0],
 *   which is often "0" for gas-only notifications)
 * - Ledger credit is keyed by onchainTransactionId → no double-credit on retry
 * - Session is only confirmed while status is still SWEEPING
 * - OnchainTransaction is resolved outside the confirm transaction so a
 *   unique conflict cannot abort the confirm transaction
 */
async function recoverStuckDepositSweep(
  notification: NonNullable<CircleWebhookPayload["notification"]>
): Promise<void> {
  if (!notification.id || !notification.walletId) return;

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

  if (!stuck) return;

  const treasury = stuck.paymentLink.organization.wallets[0];
  if (!treasury) {
    console.error(
      `[webhooks/circle] SWEEPING session ${stuck.id} has no treasury wallet — cannot recover`
    );
    return;
  }

  const amount = stuck.amountExpected;
  if (amount <= 0n) {
    console.error(
      `[webhooks/circle] SWEEPING session ${stuck.id} has non-positive amountExpected — refusing recovery`
    );
    return;
  }

  const txHash = notification.txHash ?? notification.id;

  // ── Step 1: resolve OnchainTransaction (committed independently) ──────
  let onchainTxId: string;

  const existing = await prisma.onchainTransaction.findFirst({
    where: {
      OR: [
        { circleTransactionId: notification.id },
        { txHash },
      ],
    },
    select: { id: true },
  });

  if (existing) {
    onchainTxId = existing.id;
  } else {
    try {
      const created = await prisma.onchainTransaction.create({
        data: {
          walletId: treasury.id,
          direction: "IN",
          amount,
          counterpartyAddress: stuck.depositAddress ?? notification.sourceAddress ?? "unknown",
          chain: treasury.chain,
          status: "CONFIRMED",
          confirmedAt: new Date(),
          txHash,
          circleTransactionId: notification.id,
          memo: `Recovered payment-link deposit sweep for session ${stuck.id}`,
        },
        select: { id: true },
      });
      onchainTxId = created.id;
    } catch (err) {
      if (!isPrismaUniqueViolation(err)) {
        console.error(
          `[webhooks/circle] failed to create OnchainTransaction for SWEEPING session ${stuck.id}`,
          err
        );
        throw err;
      }
      const again = await prisma.onchainTransaction.findFirst({
        where: {
          OR: [
            { circleTransactionId: notification.id },
            { txHash },
          ],
        },
        select: { id: true },
      });
      if (!again) {
        console.error(
          `[webhooks/circle] P2002 on OnchainTransaction but row not found for session ${stuck.id}`
        );
        throw err;
      }
      onchainTxId = again.id;
    }
  }

  // ── Step 2: confirm in a clean transaction (ledger + counters + status) ─
  try {
    await prisma.$transaction(async (tx) => {
      const stillStuck = await tx.paymentLinkPayment.findFirst({
        where: { id: stuck.id, status: "SWEEPING" },
        select: { id: true },
      });
      // Another worker already confirmed — do nothing (no double counters)
      if (!stillStuck) return;

      await confirmPaymentLinkPayment(tx, {
        paymentLinkPaymentId: stuck.id,
        onchainTransactionId: onchainTxId,
        amountPaid: amount,
      });
    });
  } catch (err) {
    // Root cause must be visible — not masked by a later 25P02
    console.error(
      `[webhooks/circle] confirmPaymentLinkPayment failed for SWEEPING session ${stuck.id} ` +
        `(onchainTx=${onchainTxId}, amount=${amount.toString()})`,
      err
    );
    throw err;
  }

  // ── Step 3: best-effort realtime (never affects money state) ───────────
  try {
    broadcastPaymentLinkSessionUpdate({
      type: "payment_link_session_update",
      paymentLinkPaymentId: stuck.id,
      status: "CONFIRMED",
      amountPaid: toDecimalString(amount),
    });
  } catch (err) {
    console.error("[webhooks/circle] broadcast session update failed after recovery", err);
  }

  try {
    broadcastPaymentReceived({
      type: "payment_received",
      orgId: stuck.paymentLink.orgId,
      amount: toDecimalString(amount),
      counterpartyAddress: stuck.depositAddress ?? "",
      onchainTransactionId: onchainTxId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[webhooks/circle] broadcast payment_received failed after recovery", err);
  }

  console.log(
    `[webhooks/circle] recovered SWEEPING session ${stuck.id} → CONFIRMED (onchainTx=${onchainTxId})`
  );
}