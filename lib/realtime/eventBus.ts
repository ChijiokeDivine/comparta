// lib/realtime/eventBus.ts
import { EventEmitter } from "node:events";
import { getRawRedisClient } from "@/jobs/queue";
import type IORedis from "ioredis";

type RealtimeGlobals = typeof globalThis & {
  __compartaRealtimeSub?: IORedis;
};

const g = globalThis as RealtimeGlobals;
export type PaymentReceivedEvent = {
  type: "payment_received";
  orgId: string;
  amount: string;
  counterpartyAddress: string;
  onchainTransactionId: string;
  createdAt: string;
};

export type PaymentLinkSessionEvent = {
  type: "payment_link_session_update";
  paymentLinkPaymentId: string;
  status: "PENDING" | "SWEEPING" | "CONFIRMED" | "FAILED" | "WRONG_AMOUNT_REFUNDED";
  amountPaid?: string;
  failureReason?: string | null;
};

export type RealtimeEvent = PaymentReceivedEvent | PaymentLinkSessionEvent;

const CHANNEL_PREFIX = "comparta:realtime:";

function sessionChannel(paymentLinkPaymentId: string): string {
  return `${CHANNEL_PREFIX}paymentLinkPayment:${paymentLinkPaymentId}`;
}

function orgChannel(orgId: string): string {
  return `${CHANNEL_PREFIX}org:${orgId}`;
}

// Local fan-out so multiple subscribers in the same process don't each
// need their own Redis subscription.
const localBus = new EventEmitter();
localBus.setMaxListeners(1000);

let subscriberReady: Promise<void> | null = null;
const activeChannels = new Set<string>();

function ensureSubscriber(): Promise<void> {
  if (subscriberReady) return subscriberReady;

  subscriberReady = (async () => {
    // Duplicate connection required for SUBSCRIBE mode
    const sub = getRawRedisClient().duplicate();
    sub.on("error", (err) => {
      console.error("[realtime] redis subscriber error:", err.message);
    });

    sub.on("message", (channel, message) => {
      try {
        const event = JSON.parse(message) as RealtimeEvent;
        localBus.emit(channel, event);
      } catch (err) {
        console.error("[realtime] failed to parse redis message", err);
      }
    });

    // If the process already has channels from earlier subscribe*() calls
    // that raced this init, subscribe them now.
    if (activeChannels.size > 0) {
      await sub.subscribe(...Array.from(activeChannels));
    }

    // Expose for subscribe helpers
    g.__compartaRealtimeSub = sub;
  })();

  return subscriberReady;
}

async function subscribeChannel(channel: string): Promise<void> {
  activeChannels.add(channel);
  await ensureSubscriber();
  const sub = g.__compartaRealtimeSub;
  if (sub) {
    // ioredis subscribe is idempotent for already-subscribed channels
    await sub.subscribe(channel);
  }
}

async function unsubscribeChannel(channel: string): Promise<void> {
  activeChannels.delete(channel);
  const sub = g.__compartaRealtimeSub;
  if (sub && activeChannels.size === 0) {
    // keep connection; only unsubscribe this channel
  }
  if (sub) {
    try {
      await sub.unsubscribe(channel);
    } catch {
      // ignore
    }
  }
}

function publish(channel: string, event: RealtimeEvent): void {
  try {
    const redis = getRawRedisClient();
    void redis.publish(channel, JSON.stringify(event)).catch((err) => {
      console.error("[realtime] redis publish failed", err);
      // Fallback: same-process listeners still get the event
      localBus.emit(channel, event);
    });
  } catch (err) {
    console.error("[realtime] redis unavailable, local-only emit", err);
    localBus.emit(channel, event);
  }
}

export function broadcastPaymentLinkSessionUpdate(event: PaymentLinkSessionEvent): void {
  publish(sessionChannel(event.paymentLinkPaymentId), event);
}

export function broadcastPaymentReceived(event: PaymentReceivedEvent): void {
  const channel = orgChannel(event.orgId);
  publish(channel, event);
  // keep wildcard for any global listeners
  publish(`${CHANNEL_PREFIX}*`, event);
}

export type UnsubscribeFn = () => void;

export function subscribeOrg(
  orgId: string,
  handler: (event: RealtimeEvent) => void
): UnsubscribeFn {
  const channel = orgChannel(orgId);
  const wrapped = (ev: RealtimeEvent) => {
    try {
      handler(ev);
    } catch (err) {
      console.error("[realtime] subscriber handler threw", channel, err);
    }
  };
  localBus.on(channel, wrapped);
  void subscribeChannel(channel);

  return () => {
    localBus.off(channel, wrapped);
    void unsubscribeChannel(channel);
  };
}

export function subscribePaymentLinkSession(
  paymentLinkPaymentId: string,
  handler: (event: PaymentLinkSessionEvent) => void
): UnsubscribeFn {
  const channel = sessionChannel(paymentLinkPaymentId);
  const wrapped = (ev: PaymentLinkSessionEvent) => {
    try {
      handler(ev);
    } catch (err) {
      console.error("[realtime] subscriber handler threw", channel, err);
    }
  };
  localBus.on(channel, wrapped);
  void subscribeChannel(channel);

  return () => {
    localBus.off(channel, wrapped);
    void unsubscribeChannel(channel);
  };
}