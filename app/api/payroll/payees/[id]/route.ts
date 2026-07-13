// app/api/payroll/payees/[id]/route.ts
//
// GET: single payee. PATCH: update (OWNER/ADMIN). DELETE: hard-delete if
// never used in a run, otherwise deactivate instead
// (lib/payroll/payees.ts#deletePayee enforces this).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  getPayee,
  updatePayee,
  deletePayee,
  PayeeNotFoundError,
  PayeeValidationError,
  PayeeIdentifierFormatError,
  PayeeInUseError,
} from "@/lib/payroll/payees";
import { serializePayee } from "@/lib/payroll/serialize";

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    identifier: z.string().min(1).optional(),
    payType: z.enum(["SALARY", "HOURLY", "CONTRACT"]).optional(),
    defaultAmount: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
    contactId: z.string().min(1).nullable().optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const payee = await getPayee(orgId, id);
    return NextResponse.json({ payee: serializePayee(payee) });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const payee = await updatePayee(ctx.orgId, id, parsed.data);
    return NextResponse.json({ payee: serializePayee(payee) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    await deletePayee(ctx.orgId, id);
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
  if (err instanceof PayeeNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof PayeeInUseError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof PayeeIdentifierFormatError || err instanceof PayeeValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[payroll/payees/:id] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}