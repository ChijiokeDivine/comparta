// jobs/workers/allocationRulesScheduled.worker.ts
//
// Daily sweep for AllocationRules with trigger = SCHEDULED — the
// counterpart to the ON_INCOMING_PAYMENT path, which fires inline from
// lib/transfers/receive.ts instead of a worker. See
// lib/allocationRules/engine.ts#runScheduledAllocationRules for the
// due-check and execution logic; this file is just the BullMQ/cron
// wiring, matching every other worker in jobs/.
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/workers/allocationRulesScheduled.worker.ts`), separate from the
// Next.js server. Schedule a daily run via
// QUEUE_NAMES.ALLOCATION_RULE_SCHEDULED_SWEEP (a BullMQ repeatable job)
// or an external cron hitting a protected internal endpoint that calls
// runScheduledAllocationRules().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { runScheduledAllocationRules } from "@/lib/allocationRules/engine";

if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.ALLOCATION_RULE_SCHEDULED_SWEEP,
    async () => runScheduledAllocationRules(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[allocationRulesScheduled] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[allocationRulesScheduled] sweep failed`, err);
  });

  console.log("[allocationRulesScheduled] worker started, listening for jobs...");
}
