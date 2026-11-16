// jobs/queue.ts
//
// Central BullMQ queue definitions. API routes enqueue jobs here; workers
// (jobs/workers/*) process them. Kept as a Postgres-independent layer so
// payroll runs, DCA transfers, and savings sweeps survive a process
// restart mid-job - Redis has the durable job state, not in-memory timers.
//
// Phase 7 (Smart Savings) note: SAVINGS_SWEEP already existed (reserved
// for this phase) and is now wired up by
// jobs/workers/savingsSweep.worker.ts. YIELD_REDEMPTION_CONFIRMATION is
// new - it's the polling queue for jobs/confirmYieldRedemption.ts,
// mirroring how CONFIRM_TRANSACTION backs jobs/confirmTransaction.ts.

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { getEnv } from "@/lib/env";
import { InMemoryRedis } from "@/lib/redis/inMemoryClient";

const globalForQueues = globalThis as unknown as {
  redisConnection: IORedis | undefined;
  queues: Record<string, Queue> | undefined;
  redisDisabledWarned: Set<string> | undefined;
};

const REDIS_DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * True when REDIS_DISABLED is set to a truthy value. Intended for local
 * development on machines without a Redis server: without this, every
 * direct Redis command waits on ioredis's retry loop (it is configured with
 * maxRetriesPerRequest: null for BullMQ) until a connection appears, which
 * reads as the server "stalling".
 */
export function isRedisDisabled(): boolean {
  return REDIS_DISABLED_VALUES.has(
    String(getEnv().REDIS_DISABLED ?? "").trim().toLowerCase()
  );
}

function warnRedisDisabledOnce(reason: string): void {
  if (!globalForQueues.redisDisabledWarned) {
    globalForQueues.redisDisabledWarned = new Set();
  }
  if (globalForQueues.redisDisabledWarned.has(reason)) return;
  globalForQueues.redisDisabledWarned.add(reason);
  console.warn(
    `[redis] REDIS_DISABLED is on — ${reason}. ` +
      `This is a local-dev mode: state is per-process and not durable. ` +
      `Unset REDIS_DISABLED (or set it to false) to use Redis again.`
  );
}

function getConnection(): ConnectionOptions {
  if (isRedisDisabled()) {
    throw new Error(
      "REDIS_DISABLED is on, so there is no BullMQ connection. " +
        "Unset REDIS_DISABLED (or set it to false) and point REDIS_URL at a " +
        "running Redis instance to run queues/workers."
    );
  }
  return getRawRedisClient() as unknown as ConnectionOptions;
}

/**
 * Returns the actual IORedis client instance, properly typed with its
 * real command methods (incr, expire, ttl, etc.) - for callers that need
 * to run Redis commands directly (e.g. lib/rateLimit.ts, lib/savings/yieldRate.ts)
 * rather than just handing a connection to BullMQ.
 *
 * When REDIS_DISABLED is on, this returns an in-memory implementation of the
 * same small command surface instead of opening a socket, so those callers
 * keep working without a Redis server.
 */
function getRawRedisClient(): IORedis {
  if (!globalForQueues.redisConnection) {
    if (isRedisDisabled()) {
      warnRedisDisabledOnce(
        "using an in-process in-memory store instead of connecting to REDIS_URL"
      );
      globalForQueues.redisConnection = new InMemoryRedis() as unknown as IORedis;
      return globalForQueues.redisConnection;
    }

    const client = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
    });

    // Without this listener, every failed reconnect attempt surfaces as
    // an "Unhandled error event" (Node's default behavior for an
    // EventEmitter's 'error' event with no listener) - which, with
    // ioredis's built-in retry loop, means an unreachable Redis prints a
    // fresh stack trace multiple times a second forever. Log it exactly
    // once per distinct error message instead, so a misconfigured/down
    // Redis is still visible without drowning out everything else.
    const loggedMessages = new Set<string>();
    client.on("error", (err: Error) => {
      const key = err.message;
      if (loggedMessages.has(key)) return;
      loggedMessages.add(key);
      console.error(
        `[redis] connection error (further identical errors this process will be suppressed): ${err.message}. ` +
          `Queue-backed features (payroll execution, savings sweep, DCA, invoice/payment-link sweeps, rate limiting) ` +
          `will not work until REDIS_URL points at a reachable Redis instance.`
      );
    });

    globalForQueues.redisConnection = client;
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
  UNIFIED_BALANCE_DEPOSIT_SWEEP: "unified-balance-deposit-sweep",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

function createRedisDisabledQueue(name: QueueName): Queue {
  const add = async () => {
    warnRedisDisabledOnce(
      `background jobs are not being enqueued (skipped "${name}"); they will not run`
    );
    return { id: `redis-disabled:${name}` };
  };
  // Only the enqueue surface is used from API routes; a full Queue would need
  // a live connection. Callers already treat add() as best-effort.
  return { name, add, addBulk: async () => [] } as unknown as Queue;
}

function getQueues(): Record<string, Queue> {
  if (!globalForQueues.queues) {
    if (isRedisDisabled()) {
      globalForQueues.queues = Object.fromEntries(
        Object.values(QUEUE_NAMES).map((name) => [name, createRedisDisabledQueue(name)])
      );
    } else {
      const connection = getConnection();
      globalForQueues.queues = Object.fromEntries(
        Object.values(QUEUE_NAMES).map((name) => [
          name,
          new Queue(name, { connection }),
        ])
      );
    }
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