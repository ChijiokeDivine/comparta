// app/api/payroll/schedules/route.ts
//
// GET: list schedules. POST: create a schedule. OWNER/ADMIN only.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { BucketNotFoundError } from "@/lib/buckets/service";
import {
  createPayrollSchedule,
  listPayrollSchedules,
  PayrollScheduleValidationError,
} from "@/lib/payroll/schedules";
import { serializePayrollSchedule } from "@/lib/payroll/serialize";

const createSchema = z
  .object({
    sourceLedgerAccountId: z.string().min(1),
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
    nextRunDate: z.string().min(1),
    name: z.string().max(200).optional(),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const activeParam = searchParams.get("active");
    const active = activeParam === null ? undefined : activeParam === "true";

    const schedules = await listPayrollSchedules(orgId, { active });
    return NextResponse.json({ schedules: schedules.map(serializePayrollSchedule) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireApprovedOrg();

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }
    assertCanManageBucket(ctx, parsed.data.sourceLedgerAccountId);

    const schedule = await createPayrollSchedule({ orgId: ctx.orgId, ...parsed.data });
    return NextResponse.json({ schedule: serializePayrollSchedule(schedule) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof KybNotApprovedError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof BucketPermissionError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof BucketNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof PayrollScheduleValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[payroll/schedules] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}