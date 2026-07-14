// app/api/dca/[id]/pause/route.ts
//
// POST: pause an ACTIVE recurring transfer. It will not execute again
// until resumed — see lib/dca/service.ts#pauseRecurringTransfer and
// jobs/processRecurringTransfers.ts's header comment on why this alone
// is sufficient to guarantee a paused transfer never fires mid-cycle.
// OWNER/ADMIN only.

import { NextResponse } from "next/server";
import {
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  pauseRecurringTransfer,
  RecurringTransferNotFoundError,
  DcaValidationError,
} from "@/lib/dca/service";
import { serializeRecurringTransfer } from "@/lib/dca/serialize";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const transfer = await pauseRecurringTransfer(ctx.orgId, id);
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
    console.error("[dca/:id/pause] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}