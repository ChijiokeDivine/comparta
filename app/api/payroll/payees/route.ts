// app/api/payroll/payees/route.ts
//
// GET: list payees (optionally filtered by active state). Any
// authenticated org member. POST: create a payee. OWNER/ADMIN only —
// same gate as buckets/allocation rules (lib/auth/canManageBucket.ts).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  createPayee,
  listPayees,
  PayeeValidationError,
  PayeeIdentifierFormatError,
} from "@/lib/payroll/payees";
import { serializePayee } from "@/lib/payroll/serialize";

const createSchema = z
  .object({
    name: z.string().min(1),
    identifier: z.string().min(1),
    payType: z.enum(["SALARY", "HOURLY", "CONTRACT"]).optional(),
    defaultAmount: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).optional(),
    contactId: z.string().min(1).optional(),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const activeParam = searchParams.get("active");
    const active = activeParam === null ? undefined : activeParam === "true";

    const payees = await listPayees(orgId, { active });
    return NextResponse.json({ payees: payees.map(serializePayee) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const payee = await createPayee({ orgId: ctx.orgId, ...parsed.data });
    return NextResponse.json({ payee: serializePayee(payee) }, { status: 201 });
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
  if (err instanceof PayeeIdentifierFormatError || err instanceof PayeeValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[payroll/payees] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}