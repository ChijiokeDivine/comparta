// app/api/payroll/runs/[id]/items/[itemId]/route.ts
//
// PATCH: change a DRAFT run item's amount. DELETE: remove a line item
// from a DRAFT run. Both only valid while the run is still DRAFT — see
// lib/payroll/runs.ts.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  updateRunItemAmount,
  removeRunItem,
  PayrollRunNotFoundError,
  PayrollRunStateError,
  PayrollRunValidationError,
} from "@/lib/payroll/runs";
import { serializePayrollRunItem } from "@/lib/payroll/serialize";

const schema = z.object({ amount: z.string().min(1) }).strict();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const item = await updateRunItemAmount(ctx.orgId, id, itemId, parsed.data.amount);
    return NextResponse.json({ item: serializePayrollRunItem(item) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    await removeRunItem(ctx.orgId, id, itemId);
    return NextResponse.json({ ok: true });
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
  console.error("[payroll/runs/:id/items/:itemId] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}