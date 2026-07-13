// app/api/savings/rules/[id]/route.ts
//
// GET: single rule detail. Any authenticated org member. PATCH: edit
// value/active/name/scheduleCron. DELETE: remove a rule that's never
// fired (otherwise 422 — deactivate instead). Both mutations are
// OWNER/ADMIN only. Mirrors app/api/allocation-rules/[id]/route.ts.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  getSavingsRule,
  updateSavingsRule,
  deleteSavingsRule,
  SavingsRuleNotFoundError,
  SavingsValidationError,
} from "@/lib/savings/service";
import { serializeSavingsRule } from "@/lib/savings/serialize";

const updateSchema = z
  .object({
    value: z.string().min(1).optional(),
    active: z.boolean().optional(),
    name: z.string().max(200).optional(),
    scheduleCron: z.string().min(1).optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const rule = await getSavingsRule(orgId, id);
    return NextResponse.json({ savingsRule: serializeSavingsRule(rule) });
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

    const rule = await updateSavingsRule(ctx.orgId, id, parsed.data);
    return NextResponse.json({ savingsRule: serializeSavingsRule(rule) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    await deleteSavingsRule(ctx.orgId, id);
    return NextResponse.json({ deleted: true });
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
  if (err instanceof SavingsRuleNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof SavingsValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[savings/rules/:id] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}