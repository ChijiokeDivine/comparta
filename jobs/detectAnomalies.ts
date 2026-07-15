// jobs/detectAnomalies.ts
//
// Lightweight sweep: runs lib/insights/anomalies/detect.ts against every
// CONFIRMED outbound transaction confirmed within the lookback window.
// The lookback window is intentionally wider than the sweep interval
// (default 6h lookback vs. an assumed ~hourly run) so a missed or slow
// sweep cycle never permanently skips a transaction — detectAnomaliesForTransaction
// is idempotent (upserts on transaction+type), so re-checking the same
// transaction across overlapping windows is always safe.
//
// Purely informational — never blocks, reverses, or holds any payment.

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { detectAnomaliesForTransaction } from "@/lib/insights/anomalies/detect";

export interface AnomalyDetectionSweepResult {
  candidatesEvaluated: number;
  anomaliesFlagged: number;
}

export async function runAnomalyDetectionSweep(
  now = new Date(),
  lookbackHours = 6
): Promise<AnomalyDetectionSweepResult> {
  const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  const candidates = await prisma.onchainTransaction.findMany({
    where: { direction: "OUT", status: "CONFIRMED", confirmedAt: { gte: since, lte: now } },
    select: { id: true },
  });

  let anomaliesFlagged = 0;

  for (const { id } of candidates) {
    try {
      const { flagged } = await detectAnomaliesForTransaction(id);
      anomaliesFlagged += flagged.length;
    } catch (err) {
      console.error(`[detectAnomalies] failed to evaluate ${id}`, err);
    }
  }

  return { candidatesEvaluated: candidates.length, anomaliesFlagged };
}

if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.ANOMALY_DETECTION_SWEEP,
    async () => runAnomalyDetectionSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[detectAnomalies] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[detectAnomalies] sweep failed`, err);
  });

  console.log("[detectAnomalies] worker started, listening for jobs...");
}