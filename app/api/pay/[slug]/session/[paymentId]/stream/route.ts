// app/api/pay/[slug]/session/[paymentId]/stream/route.ts
//
// SSE counterpart to the plain GET .../session/[paymentId] route, for the
// WALLET checkout path only. That route is unchanged and still backs the
// CARD path's polling loop (Circle's hosted checkout has no return-URL
// hook to push through, so card keeps polling for now).
//
// Same slug+paymentId scoping as the GET route, same reason: a stale or
// mismatched session id from a different link's checkout can never
// subscribe to another merchant's payment status here.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import {
  subscribePaymentLinkSession,
  type PaymentLinkSessionEvent,
} from "@/lib/realtime/eventBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["CONFIRMED", "FAILED", "WRONG_AMOUNT_REFUNDED"]);
const HEARTBEAT_MS = 15_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; paymentId: string }> }
) {
  const { slug, paymentId } = await params;

  const payment = await prisma.paymentLinkPayment.findFirst({
    where: { id: paymentId, paymentLink: { slug } },
    select: { id: true, status: true, amountPaid: true, failureReason: true },
  });

  if (!payment) {
    return new Response("Checkout session not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
      };

      const send = (event: Pick<PaymentLinkSessionEvent, "paymentLinkPaymentId" | "status" | "amountPaid" | "failureReason">) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (TERMINAL_STATUSES.has(event.status)) {
          cleanup();
          controller.close();
        }
      };

      // Send whatever the DB already says immediately - closes the race
      // where the webhook lands (and fires an event) between the payer's
      // page load and the subscribe() call below.
      send({
        paymentLinkPaymentId: payment.id,
        status: payment.status as PaymentLinkSessionEvent["status"],
        amountPaid: payment.amountPaid !== null ? toDecimalString(payment.amountPaid) : undefined,
        failureReason: payment.failureReason,
      });

      if (!TERMINAL_STATUSES.has(payment.status)) {
        unsubscribe = subscribePaymentLinkSession(payment.id, send);
        // Keep the connection alive through idle-timeout proxies while
        // waiting on Circle's webhook + the sweep.
        heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        }, HEARTBEAT_MS);
      }

      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}