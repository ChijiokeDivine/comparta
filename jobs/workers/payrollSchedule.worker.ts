// jobs/workers/payrollSchedule.worker.ts
//
// Daily sweep for PayrollSchedule — the counterpart to
// jobs/workers/allocationRulesScheduled.worker.ts, same BullMQ/cron
// wiring. See lib/payroll/scheduler.ts#runPayrollScheduleSweep for the
// due-check, run-generation, and nextRunDate-advance logic; this file is
// just the worker process wiring.
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/workers/payrollSchedule.worker.ts`), separate from the Next.js
// server. Schedule a daily run via QUEUE_NAMES.PAYROLL_SCHEDULE_SWEEP (a
// BullMQ repeatable job) or an external cron hitting a protected
// internal endpoint that calls runPayrollScheduleSweep().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { runPayrollScheduleSweep } from "@/lib/payroll/scheduler";

if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.PAYROLL_SCHEDULE_SWEEP,
    async () => runPayrollScheduleSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[payrollSchedule] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[payrollSchedule] sweep failed`, err);
  });

  console.log("[payrollSchedule] worker started, listening for jobs...");
}