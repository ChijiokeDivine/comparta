// lib/realtime/eventBus.ts
//
// Cross-instance realtime via Redis pub/sub, with local EventEmitter fan-out
// and graceful fallback when Redis lacks PUBLISH (e.g. Upstash ACL NOPERM).

import { EventEmitter } from "node:events";
import type IORedis from "ioredis";
import { getRawRedisClient } from "@/jobs/queue";

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

const localBus = new EventEmitter();
localBus.setMaxListeners(1000);

let subscriberReady: Promise<void> | null = null;
const activeChannels = new Set<string>();

/** Log each distinct Redis permission/error once per process */
const loggedRedisMessages = new Set<string>();

function logRedisOnce(prefix: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (loggedRedisMessages.has(message)) return;
  loggedRedisMessages.add(message);
  console.error(
    `${prefix} ${message} (further identical errors this process will be suppressed). ` +
      `SSE across instances needs Redis PUBLISH/SUBSCRIBE. Polling still works without it. ` +
      `On Upstash: enable Pub/Sub or use a token with publish+subscribe permissions.`
  );
}

function ensureSubscriber(): Promise<void> {
  if (subscriberReady) return subscriberReady;

  subscriberReady = (async () => {
    try {
      const sub = getRawRedisClient().duplicate();
      sub.on("error", (err: Error) => {
        logRedisOnce("[realtime] redis subscriber error:", err);
      });

      sub.on("message", (channel: string, message: string) => {
        try {
          const event = JSON.parse(message) as RealtimeEvent;
          localBus.emit(channel, event);
        } catch (err) {
          console.error("[realtime] failed to parse redis message", err);
        }
      });

      if (activeChannels.size > 0) {
        await sub.subscribe(...Array.from(activeChannels));
      }

      g.__compartaRealtimeSub = sub;
    } catch (err) {
      logRedisOnce("[realtime] failed to init redis subscriber:", err);
      // Leave subscriberReady resolved so we don't retry-storm; local bus still works
    }
  })();

  return subscriberReady;
}

async function subscribeChannel(channel: string): Promise<void> {
  activeChannels.add(channel);
  await ensureSubscriber();
  const sub = g.__compartaRealtimeSub;
  if (!sub) return;
  try {
    await sub.subscribe(channel);
  } catch (err) {
    logRedisOnce("[realtime] redis subscribe failed:", err);
  }
}

async function unsubscribeChannel(channel: string): Promise<void> {
  activeChannels.delete(channel);
  const sub = g.__compartaRealtimeSub;
  if (!sub) return;
  try {
    await sub.unsubscribe(channel);
  } catch {
    // ignore
  }
}

function publish(channel: string, event: RealtimeEvent): void {
  // Always notify same-process listeners (SSE on this instance, dashboard, etc.)
  localBus.emit(channel, event);

  try {
    const redis = getRawRedisClient();
    void redis.publish(channel, JSON.stringify(event)).catch((err) => {
      logRedisOnce("[realtime] redis publish failed:", err);
    });
  } catch (err) {
    logRedisOnce("[realtime] redis unavailable:", err);
  }
}

export function broadcastPaymentLinkSessionUpdate(event: PaymentLinkSessionEvent): void {
  publish(sessionChannel(event.paymentLinkPaymentId), event);
}

export function broadcastPaymentReceived(event: PaymentReceivedEvent): void {
  publish(orgChannel(event.orgId), event);
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