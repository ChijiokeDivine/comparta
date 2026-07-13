// app/api/payroll/runs/[id]/approve/route.ts
//
// POST: PENDING_APPROVAL -> PROCESSING, then enqueues execution. The one
// route in this feature that actually authorizes money to leave the
// business — OWNER/ADMIN only, and lib/payroll/runs.ts#approveRun
// re-validates identifier resolvability and the source bucket's live
// balance before allowing it, on top of the role check here.

import { NextResponse } from "next/server";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  approveRun,
  PayrollRunNotFoundError,
  PayrollRunStateError,
  InsufficientPayrollBalanceError,
  UnresolvedPayeeIdentifiersError,
} from "@/lib/payroll/runs";
import { serializePayrollRun } from "@/lib/payroll/serialize";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const run = await approveRun(ctx.orgId, id, ctx.userId);
    return NextResponse.json({ run: serializePayrollRun(run) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof KybNotApprovedError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof BucketPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof PayrollRunNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PayrollRunStateError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof InsufficientPayrollBalanceError) {
      return NextResponse.json(
        { error: err.message, required: err.required.toString(), available: err.available.toString() },
        { status: 422 }
      );
    }
    if (err instanceof UnresolvedPayeeIdentifiersError) {
      return NextResponse.json({ error: err.message, payeeNames: err.payeeNames }, { status: 422 });
    }
    console.error("[payroll/runs/:id/approve] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}