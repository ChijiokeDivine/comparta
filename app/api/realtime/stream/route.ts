// app/api/realtime/stream/route.ts
//
// Server-Sent Events (SSE) stream for realtime dashboard updates.
//
// Usage (browser):
//   const es = new EventSource("/api/realtime/stream", { withCredentials: true });
//   es.addEventListener("payment_received", (ev) => {
//     const data = JSON.parse(ev.data);
//     // refresh UI + play sound
//   });
//
// Why SSE and not WebSockets:
//   - One-way push (server -> client) is all we need today
//   - Built into the browser, no extra library
//   - Automatic reconnection with Last-Event-ID
//   - Works over plain HTTP/2; Next.js App Router supports streaming Response natively

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { subscribeOrg, type RealtimeEvent } from "@/lib/realtime/eventBus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const orgId = session.user.orgId;

  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (raw: string) => {
        try {
          controller.enqueue(encoder.encode(raw));
        } catch {
          cleanup();
        }
      };

      const sendEvent = (event: string, data: Record<string, unknown>) => {
        const payload =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        send(payload);
      };

      sendEvent("connected", { orgId });

      const onEvent = (ev: RealtimeEvent) => {
        if (ev.type === "payment_received") {
          sendEvent("payment_received", ev as unknown as Record<string, unknown>);
        }
      };

      unsubscribe = subscribeOrg(orgId, onEvent);

      heartbeat = setInterval(() => {
        send(": ping\n\n");
      }, 25000);

      req.signal.addEventListener("abort", cleanup);
    },

    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
      unsubscribe = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
