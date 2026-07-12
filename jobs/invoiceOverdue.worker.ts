// jobs/invoiceOverdue.worker.ts
//
// Daily sweep: any SENT/VIEWED invoice past its dueDate flips to OVERDUE.
// Reminder emails are rate-limited to three milestones — due date, +3
// days, +7 days — then stop entirely, tracked via Invoice.reminderCount
// so a job that's late (ran a day behind, or double-fires) never sends a
// milestone twice.
//
// Run this file with a long-lived Node process (e.g. `tsx
// jobs/invoiceOverdue.worker.ts`), separate from the Next.js server.
// Schedule a daily run via QUEUE_NAMES.INVOICE_OVERDUE_SWEEP (a BullMQ
// repeatable job) or an external cron hitting a protected internal
// endpoint that calls runInvoiceOverdueSweep().

import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "@/jobs/queue";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { sendInvoiceReminderEmail } from "@/lib/notifications/notify";

const REMINDER_MILESTONE_DAYS = [0, 3, 7]; // days past due; reminderCount indexes into this
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OverdueSweepResult {
  flippedToOverdue: number;
  remindersSent: number;
}

export async function runInvoiceOverdueSweep(): Promise<OverdueSweepResult> {
  const now = new Date();

  // 1. Flip anything SENT/VIEWED past its due date to OVERDUE. No
  // dedicated InvoiceEvent type exists for this per the Phase 3 spec's
  // event enum — the status column itself is the record; reminder sends
  // below still log REMINDER_SENT events for the audit trail.
  const flip = await prisma.invoice.updateMany({
    where: { status: { in: ["SENT", "VIEWED"] }, dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });

  // 2. Rate-limited reminders for every OVERDUE invoice that hasn't
  // exhausted its 3 milestones yet.
  const candidates = await prisma.invoice.findMany({
    where: { status: "OVERDUE", reminderCount: { lt: REMINDER_MILESTONE_DAYS.length } },
    include: { organization: { select: { legalName: true } } },
  });

  let remindersSent = 0;

  for (const invoice of candidates) {
    const daysPastDue = Math.floor((now.getTime() - invoice.dueDate.getTime()) / MS_PER_DAY);
    const nextMilestone = REMINDER_MILESTONE_DAYS[invoice.reminderCount];
    if (nextMilestone === undefined || daysPastDue < nextMilestone) continue;

    const recipientEmail = resolveRecipientEmail(invoice.recipientIdentifier, invoice.recipientEmail);

    try {
      if (recipientEmail) {
        await sendInvoiceReminderEmail({
          invoiceId: invoice.id,
          orgLegalName: invoice.organization.legalName,
          recipientEmail,
          total: toDecimalString(invoice.total),
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          publicUrl: `/invoice/${invoice.id}`,
          daysPastDue,
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { reminderCount: { increment: 1 }, lastReminderAt: now },
        });
        await tx.invoiceEvent.create({
          data: {
            invoiceId: invoice.id,
            eventType: "REMINDER_SENT",
            metadata: { milestoneDays: nextMilestone } as never,
          },
        });
      });

      remindersSent += 1;
    } catch (err) {
      console.error(`[invoiceOverdue] reminder failed for invoice ${invoice.id}`, err);
      // Don't increment reminderCount on failure — retried on the next sweep.
    }
  }

  return { flippedToOverdue: flip.count, remindersSent };
}

function resolveRecipientEmail(recipientIdentifier: string, recipientEmail: string | null): string | null {
  if (recipientEmail) return recipientEmail;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientIdentifier) ? recipientIdentifier : null;
}

// Only start the worker loop when this file is run directly (not when
// imported for its runInvoiceOverdueSweep export, e.g. from an internal
// cron-triggered API route).
if (require.main === module) {
  const worker = new Worker(
    QUEUE_NAMES.INVOICE_OVERDUE_SWEEP,
    async () => runInvoiceOverdueSweep(),
    { connection: getRedisConnection() }
  );

  worker.on("completed", (job, result) => {
    console.log(`[invoiceOverdue] sweep complete`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[invoiceOverdue] sweep failed`, err);
  });

  console.log("[invoiceOverdue] worker started, listening for jobs...");
}