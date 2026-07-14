// lib/dca/schedule.ts
//
// Pure date-math for advancing RecurringTransfer.nextExecutionDate by a
// frequency interval. Mirrors lib/payroll/schedules.ts#computeNextRunDate
// exactly (including the calendar-month day-clamping behavior for
// MONTHLY), with one addition: DAILY, which PayrollFrequency has no
// equivalent for.
//
// UTC ALWAYS. Every date this module touches is treated as already being
// in UTC (Date's own UTC* methods are used throughout) — converting a
// user's local "every Friday at 9am" input into the correct UTC instant
// is the API layer's job (see lib/dca/service.ts), not this module's.
// nextExecutionDate is stored and compared in UTC everywhere in this
// feature; be explicit about that in any UI that displays it.

import type { RecurringTransferFrequency } from "@/app/generated/prisma/client";

/**
 * Advances `from` by one frequency interval.
 * DAILY/WEEKLY/BIWEEKLY are exact day-count adds; MONTHLY adds a
 * calendar month (with day-of-month clamping for short months, e.g.
 * Jan 31 + 1 month -> Feb 28/29) rather than a fixed ~30-day add, so a
 * "1st of the month" schedule stays on the 1st indefinitely instead of
 * drifting.
 */
export function computeNextExecutionDate(
  from: Date,
  frequency: RecurringTransferFrequency
): Date {
  const next = new Date(from.getTime());

  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
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
      const daysInTargetMonth = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
      ).getUTCDate();
      next.setUTCDate(Math.min(targetDay, daysInTargetMonth));
      return next;
    }
  }
}