// app/api/dca/[id]/resume/route.ts
//
// POST: resume a PAUSED recurring transfer. See
// lib/dca/service.ts#resumeRecurringTransfer for the "catch up once on
// the very next sweep, don't try to replay missed cycles" behavior if
// nextExecutionDate fell in the past while paused. OWNER/ADMIN only.

import { NextResponse } from "next/server";
import {
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  resumeRecurringTransfer,
  RecurringTransferNotFoundError,
  DcaValidationError,
} from "@/lib/dca/service";
import { serializeRecurringTransfer } from "@/lib/dca/serialize";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx);

    const transfer = await resumeRecurringTransfer(ctx.orgId, id);
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
    console.error("[dca/:id/resume] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}