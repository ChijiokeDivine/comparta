// app/api/payroll/schedules/[id]/route.ts
//
// GET: single schedule. PATCH: update. DELETE: deactivate (schedules are
// never hard-deleted — their PayrollRun history references them).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { BucketNotFoundError } from "@/lib/buckets/service";
import {
  getPayrollSchedule,
  updatePayrollSchedule,
  deactivatePayrollSchedule,
  PayrollScheduleNotFoundError,
  PayrollScheduleValidationError,
} from "@/lib/payroll/schedules";
import { serializePayrollSchedule } from "@/lib/payroll/serialize";

const updateSchema = z
  .object({
    sourceLedgerAccountId: z.string().min(1).optional(),
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]).optional(),
    nextRunDate: z.string().min(1).optional(),
    name: z.string().max(200).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const schedule = await getPayrollSchedule(orgId, id);
    return NextResponse.json({ schedule: serializePayrollSchedule(schedule) });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }
    assertCanManageBucket(ctx, parsed.data.sourceLedgerAccountId);

    const schedule = await updatePayrollSchedule(ctx.orgId, id, parsed.data);
    return NextResponse.json({ schedule: serializePayrollSchedule(schedule) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const schedule = await deactivatePayrollSchedule(ctx.orgId, id);
    return NextResponse.json({ schedule: serializePayrollSchedule(schedule) });
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
  if (err instanceof PayrollScheduleNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof BucketNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof PayrollScheduleValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[payroll/schedules/:id] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}