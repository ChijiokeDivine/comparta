// app/api/payroll/runs/[id]/items/[itemId]/retry/route.ts
//
// POST: manually retry a single FAILED item without touching any other
// item on the run — the per-item-isolation requirement from the
// execution spec, surfaced as an explicit recovery action. See
// jobs/executePayroll.ts#retryPayrollRunItem.

import { NextResponse } from "next/server";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { retryPayrollRunItem } from "@/jobs/executePayroll";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    await retryPayrollRunItem(ctx.orgId, id, itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof KybNotApprovedError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof BucketPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("[payroll/runs/:id/items/:itemId/retry] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}