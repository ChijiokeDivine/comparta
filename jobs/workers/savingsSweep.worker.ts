// jobs/workers/savingsSweep.worker.ts
//
// Daily sweep for SavingsRules with trigger = FIXED_RECURRING — the
// counterpart to PERCENTAGE_OF_INCOME (fires inline from
// lib/transfers/receive.ts) and ROUND_UP (fires inline from
// lib/transfers/send.ts). See lib/savings/sweep.ts#runScheduledSavingsRules
// for the due-check, floor-clamping, and yield-deployment logic; this
// file is just the BullMQ/cron wiring, matching every other worker in
// jobs/ (e.g. jobs/workers/allocationRulesScheduled.worker.ts).
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/workers/savingsSweep.worker.ts`), separate from the Next.js
// server. Schedule a daily run via QUEUE_NAMES.SAVINGS_SWEEP (a BullMQ
// repeatable job) or an external cron hitting a protected internal
// endpoint that calls runScheduledSavingsRules().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { runScheduledSavingsRules } from "@/lib/savings/sweep";

if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.SAVINGS_SWEEP,
    async () => runScheduledSavingsRules(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[savingsSweep] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[savingsSweep] sweep failed`, err);
  });

  console.log("[savingsSweep] worker started, listening for jobs...");
}