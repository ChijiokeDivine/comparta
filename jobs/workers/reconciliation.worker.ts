// jobs/workers/reconciliation.worker.ts
//
// Periodically recomputes every org's ledger balances from full
// LedgerEntry history and compares against the denormalized balanceAfter
// snapshots. A mismatch means either a bug in recordEntry()'s callers or an
// entry written outside the ledger engine — both should page someone
// immediately, since it means our books don't reconcile.
//
// Run this file with a long-lived Node process (e.g. `tsx jobs/workers/reconciliation.worker.ts`),
// separate from the Next.js server. Enqueue a run on a schedule via
// QUEUE_NAMES.RECONCILIATION (a BullMQ repeatable job) or an external cron
// hitting a protected internal endpoint that calls runReconciliationSweep().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { reconcileOrg } from "@/lib/ledger/engine";

export async function runReconciliationSweep(): Promise<{
  orgsChecked: number;
  mismatches: { orgId: string; ledgerAccountId: string }[];
}> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const mismatches: { orgId: string; ledgerAccountId: string }[] = [];

  for (const org of orgs) {
    const results = await reconcileOrg(org.id);
    for (const r of results) {
      if (!r.matches) {
        mismatches.push({ orgId: org.id, ledgerAccountId: r.ledgerAccountId });
        console.error(
          `[reconciliation] MISMATCH org=${org.id} account=${r.ledgerAccountId} ` +
            `snapshot=${r.snapshotBalance} computed=${r.computedBalance}`
        );
      }
    }
  }

  return { orgsChecked: orgs.length, mismatches };
}

// Only start the worker loop when this file is run directly (not when
// imported for its runReconciliationSweep export, e.g. from an API route).
if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.RECONCILIATION,
    async () => runReconciliationSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[reconciliation] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[reconciliation] sweep failed`, err);
  });

  console.log("[reconciliation] worker started, listening for jobs...");
}
