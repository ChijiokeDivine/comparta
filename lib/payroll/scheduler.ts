// lib/payroll/scheduler.ts
//
// Daily sweep for PayrollSchedule: finds every active schedule whose
// nextRunDate is due, generates a DRAFT PayrollRun for it (still
// requiring full human approval before anything executes — see
// lib/payroll/runs.ts), then advances nextRunDate by the schedule's
// frequency. Wired up by jobs/workers/payrollSchedule.worker.ts, the
// same BullMQ/cron pattern as
// jobs/workers/allocationRulesScheduled.worker.ts.
//
// Duplicate-run guard: PayrollRun has a
// @@unique([payrollScheduleId, scheduledFor]) constraint. Before
// generating, this module checks for an existing run at that
// (schedule, date) pair and skips if found — belt-and-suspenders with
// the DB constraint, which is what actually protects against two
// overlapping sweep invocations both slipping past the pre-check race.

import { prisma } from "@/lib/db/prisma";
import { generateDraftRunFromSchedule } from "./runs";
import { computeNextRunDate } from "./schedules";

export interface PayrollScheduleSweepResult {
  schedulesEvaluated: number;
  runsCreated: string[]; // PayrollRun ids
  skipped: { scheduleId: string; reason: string }[];
}

/**
 * A schedule is due once its nextRunDate has arrived (day granularity —
 * this is meant to run once daily, same posture as
 * runScheduledAllocationRules in lib/allocationRules/engine.ts).
 */
function isScheduleDue(nextRunDate: Date, now: Date): boolean {
  return nextRunDate.getTime() <= now.getTime();
}

/** Called by jobs/workers/payrollSchedule.worker.ts (daily). */
export async function runPayrollScheduleSweep(now = new Date()): Promise<PayrollScheduleSweepResult> {
  const schedules = await prisma.payrollSchedule.findMany({ where: { active: true } });
  const dueSchedules = schedules.filter((s) => isScheduleDue(s.nextRunDate, now));

  const runsCreated: string[] = [];
  const skipped: { scheduleId: string; reason: string }[] = [];

  for (const schedule of dueSchedules) {
    const scheduledFor = schedule.nextRunDate;

    const existing = await prisma.payrollRun.findFirst({
      where: { payrollScheduleId: schedule.id, scheduledFor },
      select: { id: true },
    });

    if (existing) {
      // Already generated (a prior sweep, or a retried job, got here
      // first). Still advance nextRunDate if it wasn't advanced yet —
      // guards against a crash that generated the run but died before
      // the advance step below.
      skipped.push({ scheduleId: schedule.id, reason: `Run already exists for ${scheduledFor.toISOString()}` });
      await advanceIfStillDue(schedule.id, scheduledFor);
      continue;
    }

    try {
      const { run, skippedPayeeNames } = await generateDraftRunFromSchedule(schedule, scheduledFor);
      runsCreated.push(run.id);
      if (skippedPayeeNames.length > 0) {
        console.warn(
          `[payrollScheduler] run ${run.id} (schedule ${schedule.id}) skipped ${skippedPayeeNames.length} ` +
            `active payee(s) with no default amount: ${skippedPayeeNames.join(", ")}. Add them manually before approving if needed.`
        );
      }
    } catch (err) {
      // A unique-constraint violation here means a concurrent sweep won
      // the race between our existence check and this create — treat it
      // exactly like the "existing" branch above, not as a real error.
      if (isUniqueConstraintError(err)) {
        skipped.push({ scheduleId: schedule.id, reason: "Duplicate run generation race — another sweep created it first." });
        await advanceIfStillDue(schedule.id, scheduledFor);
        continue;
      }
      console.error(`[payrollScheduler] failed to generate run for schedule ${schedule.id}`, err);
      skipped.push({ scheduleId: schedule.id, reason: err instanceof Error ? err.message : "Unknown error" });
      continue; // never advance nextRunDate on a genuine failure — retry next sweep
    }

    await advanceSchedule(schedule.id, scheduledFor, schedule.frequency);
  }

  return { schedulesEvaluated: dueSchedules.length, runsCreated, skipped };
}

async function advanceSchedule(
  scheduleId: string,
  scheduledFor: Date,
  frequency: Parameters<typeof computeNextRunDate>[1]
): Promise<void> {
  const nextRunDate = computeNextRunDate(scheduledFor, frequency);
  await prisma.payrollSchedule.update({ where: { id: scheduleId }, data: { nextRunDate } });
}

/** Advances nextRunDate only if it still equals the date we just handled — avoids clobbering a date some other process already moved forward. */
async function advanceIfStillDue(scheduleId: string, scheduledFor: Date): Promise<void> {
  const schedule = await prisma.payrollSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) return;
  if (schedule.nextRunDate.getTime() !== scheduledFor.getTime()) return; // already advanced
  await advanceSchedule(scheduleId, scheduledFor, schedule.frequency);
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}