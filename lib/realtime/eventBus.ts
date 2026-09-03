// lib/realtime/eventBus.ts
//
// In-process pub/sub for realtime dashboard updates.
//
// Single-server deployment is fine for today: native Node EventEmitter.
// When Comparta scales to multiple Next.js instances, swap the emit/on
// implementations for Redis PubSub (ioredis already in package.json) — the
// public `broadcastPaymentReceived` / `subscribeOrg` surface stays identical.

import { EventEmitter } from "node:events";

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

function sessionChannel(paymentLinkPaymentId: string): string {
  return `paymentLinkPayment:${paymentLinkPaymentId}`;
}

export function broadcastPaymentLinkSessionUpdate(event: PaymentLinkSessionEvent): void {
  bus.emit(sessionChannel(event.paymentLinkPaymentId), event);
}

const bus = new EventEmitter();
bus.setMaxListeners(1000);

function orgChannel(orgId: string): string {
  return `org:${orgId}`;
}

export function broadcastPaymentReceived(event: PaymentReceivedEvent): void {
  const channel = orgChannel(event.orgId);
  bus.emit(channel, event);
  bus.emit("*", event);
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
      console.error("[realtime] subscriber handler threw for channel", channel, err);
    }
  };
  bus.on(channel, wrapped);
  return () => {
    bus.off(channel, wrapped);
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
      console.error("[realtime] subscriber handler threw for channel", channel, err);
    }
  };
  bus.on(channel, wrapped);
  return () => bus.off(channel, wrapped);
}