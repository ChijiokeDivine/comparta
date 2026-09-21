// jobs/workers/unifiedBalanceDeposit.worker.ts
//
// Periodic sweep that detects new plain USDC on each wallet's registered
// non-Arc chains and deposits it into Circle Gateway's Unified Balance,
// crediting the ledger - see lib/circle/autoDeposit.ts for the actual
// logic; this file is just the BullMQ/cron wiring, matching every other
// worker in jobs/ (e.g. jobs/workers/savingsSweep.worker.ts).
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/workers/unifiedBalanceDeposit.worker.ts`), separate from the
// Next.js server. Schedule a run every few minutes via
// QUEUE_NAMES.UNIFIED_BALANCE_DEPOSIT_SWEEP (a BullMQ repeatable job) or
// an external cron hitting a protected internal endpoint that calls
// runAutoDepositSweep() - same two options savingsSweep.worker.ts's
// header comment lays out. A few-minute cadence is reasonable here since,
// unlike savings/payroll sweeps, the only cost of running often is a
// handful of Circle balance-check API calls per wallet - depositing only
// ever happens when a real delta is found.

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { runAutoDepositSweep } from "@/lib/circle/autoDeposit";

if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.UNIFIED_BALANCE_DEPOSIT_SWEEP,
    async () => runAutoDepositSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    const deposited = Array.isArray(result) ? result.filter((r) => r.outcome === "deposited") : [];
    const failed = Array.isArray(result) ? result.filter((r) => r.outcome === "failed") : [];
    console.log(
      `[unifiedBalanceDeposit] sweep complete - ${deposited.length} deposited, ${failed.length} failed`,
      failed.length ? failed : undefined
    );
  });
  worker.on("failed", (job, err) => {
    console.error(`[unifiedBalanceDeposit] sweep failed`, err);
  });

  console.log("[unifiedBalanceDeposit] worker started, listening for jobs...");
}
