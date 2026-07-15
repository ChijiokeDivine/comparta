// jobs/queue.ts
//
// Central BullMQ queue definitions. API routes enqueue jobs here; workers
// (jobs/workers/*) process them. Kept as a Postgres-independent layer so
// payroll runs, DCA transfers, and savings sweeps survive a process
// restart mid-job — Redis has the durable job state, not in-memory timers.
//
// Phase 7 (Smart Savings) note: SAVINGS_SWEEP already existed (reserved
// for this phase) and is now wired up by
// jobs/workers/savingsSweep.worker.ts. YIELD_REDEMPTION_CONFIRMATION is
// new — it's the polling queue for jobs/confirmYieldRedemption.ts,
// mirroring how CONFIRM_TRANSACTION backs jobs/confirmTransaction.ts.

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { getEnv } from "@/lib/env";

const globalForQueues = globalThis as unknown as {
  redisConnection: IORedis | undefined;
  queues: Record<string, Queue> | undefined;
};

function getConnection(): ConnectionOptions {
  return getRawRedisClient() as unknown as ConnectionOptions;
}

/**
 * Returns the actual IORedis client instance, properly typed with its
 * real command methods (incr, expire, ttl, etc.) — for callers that need
 * to run Redis commands directly (e.g. lib/rateLimit.ts, lib/savings/yieldRate.ts)
 * rather than just handing a connection to BullMQ.
 */
function getRawRedisClient(): IORedis {
  if (!globalForQueues.redisConnection) {
    globalForQueues.redisConnection = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
  }
  return globalForQueues.redisConnection;
}

export const QUEUE_NAMES = {
  RECONCILIATION: "ledger-reconciliation",
  WEBHOOK_PROCESSING: "circle-webhook-processing",
  PAYROLL_RUN: "payroll-run",
  SAVINGS_SWEEP: "savings-sweep",
  DCA_EXECUTION: "dca-execution",
  CONFIRM_TRANSACTION: "confirm-transaction",
  INVOICE_OVERDUE_SWEEP: "invoice-overdue-sweep",
  PAYMENT_LINK_EXPIRY_SWEEP: "payment-link-expiry-sweep",
  ALLOCATION_RULE_SCHEDULED_SWEEP: "allocation-rule-scheduled-sweep",
  PAYROLL_SCHEDULE_SWEEP: "payroll-schedule-sweep",
  YIELD_REDEMPTION_CONFIRMATION: "yield-redemption-confirmation",
  RECURRING_TRANSFER_SWEEP: "recurring-transfer-sweep",
  TRANSACTION_CATEGORIZATION_SWEEP: "transaction-categorization-sweep",
  ANOMALY_DETECTION_SWEEP: "anomaly-detection-sweep",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

function getQueues(): Record<string, Queue> {
  if (!globalForQueues.queues) {
    const connection = getConnection();
    globalForQueues.queues = Object.fromEntries(
      Object.values(QUEUE_NAMES).map((name) => [
        name,
        new Queue(name, { connection }),
      ])
    );
  }
  return globalForQueues.queues;
}

export function getQueue(name: QueueName): Queue {
  const queue = getQueues()[name];
  if (!queue) {
    throw new Error(`No queue registered for name "${name}"`);
  }
  return queue;
}

export { getConnection as getRedisConnection, getRawRedisClient };