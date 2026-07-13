// app/api/payroll/runs/[id]/route.ts
//
// GET: the full review payload for a run — line-by-line breakdown, total
// cost, source bucket balance check with exact shortfall if
// insufficient, and any unresolved-identifier flags. This is what backs
// the run review screen before approval, and doubles as the run-history
// detail view afterward.
// DELETE: remove a DRAFT run entirely (e.g. an auto-generated run the
// org doesn't want this period). Non-DRAFT runs are never deletable —
// they're the audit trail.

import { NextResponse } from "next/server";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { BucketNotFoundError } from "@/lib/buckets/service";
import {
  getPayrollRunReview,
  deleteDraftRun,
  PayrollRunNotFoundError,
  PayrollRunStateError,
} from "@/lib/payroll/runs";
import { serializePayrollRunItem } from "@/lib/payroll/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const review = await getPayrollRunReview(orgId, id);

    return NextResponse.json({
      run: {
        ...review.run,
        totalAmount: review.totalAmount,
        items: review.run.items.map(serializePayrollRunItem),
      },
      sourceBucketName: review.sourceBucketName,
      sourceBucketBalance: review.sourceBucketBalance,
      insufficientFunds: review.insufficientFunds,
      shortfall: review.shortfall,
      unresolvedIdentifiers: review.unresolvedIdentifiers,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    await deleteDraftRun(ctx.orgId, id);
    return NextResponse.json({ ok: true });
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
  if (err instanceof PayrollRunNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof BucketNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof PayrollRunStateError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error("[payroll/runs/:id] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}