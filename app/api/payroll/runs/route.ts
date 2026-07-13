// app/api/payroll/runs/route.ts
//
// GET: list runs (optionally filtered by status/schedule). POST: create
// a manual (one-off) DRAFT run. OWNER/ADMIN only — schedule-generated
// runs are created by lib/payroll/scheduler.ts, not through this route.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { BucketNotFoundError } from "@/lib/buckets/service";
import { createManualRun, listPayrollRuns, PayrollRunValidationError } from "@/lib/payroll/runs";
import { serializePayrollRun } from "@/lib/payroll/serialize";

const createSchema = z
  .object({
    sourceLedgerAccountId: z.string().min(1),
    items: z
      .array(
        z
          .object({
            payeeId: z.string().min(1),
            amount: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as
      | "DRAFT"
      | "PENDING_APPROVAL"
      | "PROCESSING"
      | "COMPLETED"
      | "FAILED"
      | null;
    const payrollScheduleId = searchParams.get("payrollScheduleId") ?? undefined;

    const runs = await listPayrollRuns(orgId, { status: status ?? undefined, payrollScheduleId });
    return NextResponse.json({ runs: runs.map(serializePayrollRun) });
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

    const run = await createManualRun({
      orgId: ctx.orgId,
      initiatedBy: ctx.userId,
      sourceLedgerAccountId: parsed.data.sourceLedgerAccountId,
      items: parsed.data.items,
    });
    return NextResponse.json({ run: serializePayrollRun(run) }, { status: 201 });
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
  if (err instanceof PayrollRunValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[payroll/runs] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}