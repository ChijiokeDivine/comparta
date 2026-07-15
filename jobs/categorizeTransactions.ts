// jobs/categorizeTransactions.ts
//
// Catch-up sweep: finds CONFIRMED OnchainTransaction rows with no
// TransactionCategorization yet and categorizes each one via
// lib/insights/categorization/service.ts#categorizeTransaction. Run this
// frequently (every few minutes is reasonable — categorization is cheap
// and mostly rule-based; LLM calls only happen for the "remainder"
// transactions the spec describes). A near-real-time alternative is to
// call categorizeTransaction() directly from
// jobs/confirmTransaction.ts's own confirmation-success path — this
// sweep is deliberately kept as a standalone safety net regardless, so a
// missed/failed inline call is never a permanent gap.
//
// Never blocks or affects the underlying transaction/payment flow in any
// way — categorization is purely additive analytics metadata.

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { categorizeTransaction } from "@/lib/insights/categorization/service";

export interface CategorizationSweepResult {
  candidatesFound: number;
  categorized: number;
  failed: number;
}

export async function runCategorizationSweep(
  batchSize = 200
): Promise<CategorizationSweepResult> {
  const candidates = await prisma.onchainTransaction.findMany({
    where: { status: "CONFIRMED", categorization: null },
    orderBy: { confirmedAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  let categorized = 0;
  let failed = 0;

  for (const { id } of candidates) {
    try {
      await categorizeTransaction(id);
      categorized++;
    } catch (err) {
      console.error(`[categorizeTransactions] failed to categorize ${id}`, err);
      failed++;
    }
  }

  return { candidatesFound: candidates.length, categorized, failed };
}

if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.TRANSACTION_CATEGORIZATION_SWEEP,
    async () => runCategorizationSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[categorizeTransactions] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[categorizeTransactions] sweep failed`, err);
  });

  console.log("[categorizeTransactions] worker started, listening for jobs...");
}