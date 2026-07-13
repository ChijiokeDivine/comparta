// app/api/payroll/runs/[id]/submit/route.ts
//
// POST: DRAFT -> PENDING_APPROVAL. Any OWNER/ADMIN can submit; approval
// itself (see ../approve/route.ts) is the step with the real friction.

import { NextResponse } from "next/server";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  submitRunForApproval,
  returnRunToDraft,
  PayrollRunNotFoundError,
  PayrollRunStateError,
  PayrollRunValidationError,
} from "@/lib/payroll/runs";
import { serializePayrollRun } from "@/lib/payroll/serialize";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const run = await submitRunForApproval(ctx.orgId, id);
    return NextResponse.json({ run: serializePayrollRun(run) });
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE here means "un-submit" — return a PENDING_APPROVAL run to DRAFT for edits, not delete it. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const run = await returnRunToDraft(ctx.orgId, id);
    return NextResponse.json({ run: serializePayrollRun(run) });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (err instanceof KybNotApprovedError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof BucketPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof PayrollRunNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof PayrollRunStateError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof PayrollRunValidationError) return NextResponse.json({ error: err.message }, { status: 422 });
  console.error("[payroll/runs/:id/submit] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}