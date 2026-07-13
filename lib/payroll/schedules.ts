// lib/payroll/schedules.ts
//
// CRUD for PayrollSchedule, plus the pure date-math for advancing
// nextRunDate by a frequency interval (used by lib/payroll/scheduler.ts
// after each successful auto-generated run). This module never touches
// PayrollRun/PayrollRunItem or moves money — see lib/payroll/scheduler.ts
// and lib/payroll/runs.ts for that.

import { prisma } from "@/lib/db/prisma";
import { getBucket } from "@/lib/buckets/service";
import type { PayrollFrequency, PayrollSchedule } from "@/app/generated/prisma/client";

export class PayrollScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollScheduleValidationError";
  }
}

export class PayrollScheduleNotFoundError extends Error {
  constructor() {
    super("Payroll schedule not found");
    this.name = "PayrollScheduleNotFoundError";
  }
}

/**
 * Advances `from` by one frequency interval. WEEKLY/BIWEEKLY are exact
 * day-count adds; MONTHLY adds a calendar month (with day-of-month
 * clamping for short months, e.g. Jan 31 + 1 month -> Feb 28/29) rather
 * than a fixed 30-day add, so a "1st of the month" schedule stays on the
 * 1st indefinitely instead of drifting.
 */
export function computeNextRunDate(from: Date, frequency: PayrollFrequency): Date {
  const next = new Date(from.getTime());
  switch (frequency) {
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "BIWEEKLY":
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    case "MONTHLY": {
      const targetDay = next.getUTCDate();
      next.setUTCDate(1); // avoid month-end overflow while we roll the month over
      next.setUTCMonth(next.getUTCMonth() + 1);
      const daysInTargetMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(targetDay, daysInTargetMonth));
      return next;
    }
  }
}

export interface CreatePayrollScheduleInput {
  orgId: string;
  sourceLedgerAccountId: string;
  frequency: PayrollFrequency;
  nextRunDate: string; // ISO date string
  name?: string;
}

export async function createPayrollSchedule(input: CreatePayrollScheduleInput): Promise<PayrollSchedule> {
  const bucket = await getBucket(input.orgId, input.sourceLedgerAccountId); // throws BucketNotFoundError if not owned
  if (bucket.archived) {
    throw new PayrollScheduleValidationError(`Bucket "${bucket.name}" is archived and can't fund a payroll schedule.`);
  }

  const nextRunDate = new Date(input.nextRunDate);
  if (Number.isNaN(nextRunDate.getTime())) {
    throw new PayrollScheduleValidationError(`"${input.nextRunDate}" isn't a valid date.`);
  }

  return prisma.payrollSchedule.create({
    data: {
      orgId: input.orgId,
      sourceLedgerAccountId: input.sourceLedgerAccountId,
      frequency: input.frequency,
      nextRunDate,
      name: input.name?.trim() || null,
    },
  });
}

export interface UpdatePayrollScheduleInput {
  sourceLedgerAccountId?: string;
  frequency?: PayrollFrequency;
  nextRunDate?: string; // ISO date string
  name?: string | null;
  active?: boolean;
}

export async function updatePayrollSchedule(
  orgId: string,
  scheduleId: string,
  input: UpdatePayrollScheduleInput
): Promise<PayrollSchedule> {
  const schedule = await getPayrollSchedule(orgId, scheduleId);

  if (input.sourceLedgerAccountId !== undefined) {
    const bucket = await getBucket(orgId, input.sourceLedgerAccountId);
    if (bucket.archived) {
      throw new PayrollScheduleValidationError(`Bucket "${bucket.name}" is archived and can't fund a payroll schedule.`);
    }
  }

  let nextRunDate: Date | undefined;
  if (input.nextRunDate !== undefined) {
    nextRunDate = new Date(input.nextRunDate);
    if (Number.isNaN(nextRunDate.getTime())) {
      throw new PayrollScheduleValidationError(`"${input.nextRunDate}" isn't a valid date.`);
    }
  }

  return prisma.payrollSchedule.update({
    where: { id: schedule.id },
    data: {
      sourceLedgerAccountId: input.sourceLedgerAccountId ?? undefined,
      frequency: input.frequency ?? undefined,
      nextRunDate: nextRunDate ?? undefined,
      name: input.name !== undefined ? input.name?.trim() || null : undefined,
      active: input.active ?? undefined,
    },
  });
}

export async function getPayrollSchedule(orgId: string, scheduleId: string): Promise<PayrollSchedule> {
  const schedule = await prisma.payrollSchedule.findFirst({ where: { id: scheduleId, orgId } });
  if (!schedule) throw new PayrollScheduleNotFoundError();
  return schedule;
}

export async function listPayrollSchedules(
  orgId: string,
  options: { active?: boolean } = {}
): Promise<PayrollSchedule[]> {
  return prisma.payrollSchedule.findMany({
    where: { orgId, ...(options.active !== undefined ? { active: options.active } : {}) },
    orderBy: [{ active: "desc" }, { nextRunDate: "asc" }],
  });
}

/** Convenience wrapper — pauses future auto-generation without deleting history. */
export async function deactivatePayrollSchedule(orgId: string, scheduleId: string): Promise<PayrollSchedule> {
  return updatePayrollSchedule(orgId, scheduleId, { active: false });
}