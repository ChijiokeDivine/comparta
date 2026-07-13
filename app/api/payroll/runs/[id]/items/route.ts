// app/api/payroll/runs/[id]/items/route.ts
//
// POST: add a payee line item to a DRAFT run (e.g. to include an HOURLY
// payee that auto-generation skipped for lacking a default amount, or to
// build up a manual run incrementally). Only valid while the run is
// still DRAFT — see lib/payroll/runs.ts#addRunItem.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { addRunItem, PayrollRunNotFoundError, PayrollRunStateError, PayrollRunValidationError } from "@/lib/payroll/runs";
import { serializePayrollRunItem } from "@/lib/payroll/serialize";

const schema = z
  .object({
    payeeId: z.string().min(1),
    amount: z.string().min(1).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const item = await addRunItem(ctx.orgId, id, parsed.data.payeeId, parsed.data.amount);
    return NextResponse.json({ item: serializePayrollRunItem(item) }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof KybNotApprovedError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof BucketPermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof PayrollRunNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof PayrollRunStateError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PayrollRunValidationError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("[payroll/runs/:id/items] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}