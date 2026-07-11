// app/api/webhooks/circle/route.ts
//
// Ingests Circle's webhook notifications (wallet transactions, challenge
// status changes, etc). Order of operations matters here:
//
//   1. Read the RAW body (needed byte-for-byte for signature verification)
//   2. Verify X-Circle-Signature against Circle's published public key
//   3. Persist the raw payload to WebhookEvent UNCONDITIONALLY, before any
//      processing — so a bug in step 4 can never lose an event. Even
//      requests that fail signature verification are stored (with
//      signatureOk: false) for audit/debugging, but are never processed.
//   4. Process, dispatching on notificationType:
//        - "transactions.inbound"  -> lib/transfers/receive.ts (credits
//          the receiving org's ledger)
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

  // Always write the raw event first — this is the "never lose an event"
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
    // Still 200 — Circle doesn't need to retry an unverifiable request,
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
      const inbound: InboundNotification = {
        circleTransactionId: notification.id,
        walletId: notification.walletId,
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
      // Our own OnchainTransaction rows are keyed by circleTransactionId
      // (see lib/transfers/send.ts), so look up by that rather than
      // trusting any org/wallet info in the webhook body.
      if (!notification?.id) return;
      const onchainTx = await prisma.onchainTransaction.findUnique({
        where: { circleTransactionId: notification.id },
        select: { id: true },
      });
      if (onchainTx) {
        await confirmTransaction(onchainTx.id);
      }
      return;
    }

    default:
      console.log(`[webhooks/circle] received event ${eventType ?? "unknown"} — no handler, ignoring`);
      return;
  }
}