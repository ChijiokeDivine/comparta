// jobs/paymentLinkExpiry.worker.ts
//
// Daily-ish sweep: any ACTIVE payment link past its expiresAt flips to
// EXPIRED. This is the bulk mechanism; lib/paymentLinks/checkout.ts also
// lazily flips a single link the moment someone loads its checkout page
// past expiry (same self-healing pattern as invoice VIEWED tracking) — so
// this sweep mainly matters for links nobody ever visits again, keeping
// the merchant-facing list view accurate without requiring a page load.
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/paymentLinkExpiry.worker.ts`), separate from the Next.js server.
// Schedule a periodic run via QUEUE_NAMES.PAYMENT_LINK_EXPIRY_SWEEP (a
// BullMQ repeatable job) or an external cron hitting a protected internal
// endpoint that calls runPaymentLinkExpirySweep().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";

export interface PaymentLinkExpirySweepResult {
  expired: number;
}

export async function runPaymentLinkExpirySweep(): Promise<PaymentLinkExpirySweepResult> {
  const now = new Date();

  const result = await prisma.paymentLink.updateMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });

  return { expired: result.count };
}

// Only start the worker loop when this file is run directly (not when
// imported for its runPaymentLinkExpirySweep export, e.g. from an
// internal cron-triggered API route).
if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.PAYMENT_LINK_EXPIRY_SWEEP,
    async () => runPaymentLinkExpirySweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[paymentLinkExpiry] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[paymentLinkExpiry] sweep failed`, err);
  });

  console.log("[paymentLinkExpiry] worker started, listening for jobs...");
}