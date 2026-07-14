// app/api/dca/[id]/route.ts
//
// GET: single recurring transfer detail. Any authenticated org member.
// PATCH: edit amount/frequency/endDate/name (source/destination are
// immutable — cancel and recreate if either needs to change). OWNER/ADMIN
// only. Status transitions (pause/resume/cancel) live in their own
// sibling routes for clean single-purpose UI actions — see
// app/api/dca/[id]/pause|resume|cancel/route.ts.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  getRecurringTransfer,
  updateRecurringTransfer,
  RecurringTransferNotFoundError,
  DcaValidationError,
} from "@/lib/dca/service";
import { serializeRecurringTransfer } from "@/lib/dca/serialize";

const updateSchema = z
  .object({
    amount: z.string().min(1).optional(),
    frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]).optional(),
    endDate: z.string().min(1).nullable().optional(),
    name: z.string().max(200).nullable().optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const transfer = await getRecurringTransfer(orgId, id);
    return NextResponse.json({ recurringTransfer: serializeRecurringTransfer(transfer) });
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

    const transfer = await updateRecurringTransfer(ctx.orgId, id, parsed.data);
    return NextResponse.json({ recurringTransfer: serializeRecurringTransfer(transfer) });
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
  if (err instanceof RecurringTransferNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof DcaValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[dca/:id] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}