// app/api/dca/[id]/cancel/route.ts
//
// POST: permanently cancel a recurring transfer (ACTIVE or PAUSED ->
// CANCELLED). Terminal — a cancelled transfer can never be resumed;
// create a new one instead. Distinct from COMPLETED (reached its
// endDate on its own) so execution history can tell the two apart.
// OWNER/ADMIN only.

import { NextResponse } from "next/server";
import {
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  cancelRecurringTransfer,
  RecurringTransferNotFoundError,
  DcaValidationError,
} from "@/lib/dca/service";
import { serializeRecurringTransfer } from "@/lib/dca/serialize";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const transfer = await cancelRecurringTransfer(ctx.orgId, id);
    return NextResponse.json({ recurringTransfer: serializeRecurringTransfer(transfer) });
  } catch (err) {
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
    console.error("[dca/:id/cancel] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}