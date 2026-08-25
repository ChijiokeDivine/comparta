// lib/insights/nlQuery/interval.ts
//
// Deliberately dependency-free (no date-fns) so this drops into the repo
// without a new package. If date-fns (or similar) is already a
// dependency elsewhere in the codebase, feel free to swap these helpers
// for it — the public surface (resolveInterval) is what matters.

import type { IntervalInput, ResolvedInterval } from "./types";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Week starts Monday.
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sun
  const diff = day === 0 ? 6 : day - 1;
  return addDays(x, -diff);
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}
function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export class IntervalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntervalParseError";
  }
}

/** now is injected (not `new Date()` inline) so this is deterministic/testable. */
export function resolveInterval(input: IntervalInput | undefined, now: Date): ResolvedInterval {
  const kind = input?.kind ?? "last_30_days";

  switch (kind) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now), label: "today" };
    case "yesterday": {
      const y = addDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y), label: "yesterday" };
    }
    case "this_week":
      return { from: startOfWeek(now), to: endOfDay(now), label: "this week" };
    case "last_week": {
      const start = addDays(startOfWeek(now), -7);
      const end = addDays(start, 6);
      return { from: start, to: endOfDay(end), label: "last week" };
    }
    case "this_month":
      return {
        from: startOfMonth(now),
        to: endOfDay(now),
        label: `this month (${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()})`,
      };
    case "last_month": {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        from: startOfMonth(lastMonthDate),
        to: endOfMonth(lastMonthDate),
        label: `last month (${MONTH_NAMES[lastMonthDate.getMonth()]} ${lastMonthDate.getFullYear()})`,
      };
    }
    case "this_year":
      return { from: startOfYear(now), to: endOfDay(now), label: `${now.getFullYear()} so far` };
    case "last_year": {
      const y = now.getFullYear() - 1;
      return { from: new Date(y, 0, 1), to: endOfYear(new Date(y, 0, 1)), label: `${y}` };
    }
    case "last_7_days":
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now), label: "the last 7 days" };
    case "last_30_days":
      return { from: startOfDay(addDays(now, -29)), to: endOfDay(now), label: "the last 30 days" };
    case "last_90_days":
      return { from: startOfDay(addDays(now, -89)), to: endOfDay(now), label: "the last 90 days" };
    case "year_to_date":
      return { from: startOfYear(now), to: endOfDay(now), label: "year to date" };
    case "all_time":
      // Org creation predates this feature in every case, so a fixed
      // early epoch is a safe "no lower bound" sentinel without making
      // the `from` field nullable throughout the rest of the pipeline.
      return { from: new Date(2020, 0, 1), to: endOfDay(now), label: "all time" };
    case "custom": {
      if (!input?.from || !input?.to) {
        throw new IntervalParseError("Custom interval requires both a start and end date.");
      }
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new IntervalParseError("Couldn't understand that date range.");
      }
      if (from > to) {
        throw new IntervalParseError("The start date is after the end date.");
      }
      return { from: startOfDay(from), to: endOfDay(to), label: `${input.from} to ${input.to}` };
    }
    default:
      // Exhaustiveness guard — a new IntervalKind added to types.ts
      // without a matching case here fails at compile time.
      throw new IntervalParseError(`Unhandled interval kind: ${kind satisfies never}`);
  }
}