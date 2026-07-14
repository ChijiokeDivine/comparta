// app/api/dca/route.ts
//
// GET: list recurring transfers (optionally filtered by status or source
// bucket). Any authenticated org member. POST: create one. OWNER/ADMIN
// only, same gate as every other bucket-mutating action.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { createRecurringTransfer, listRecurringTransfers, DcaValidationError } from "@/lib/dca/service";
import { BucketNotFoundError } from "@/lib/buckets/service";
import { serializeRecurringTransfer } from "@/lib/dca/serialize";

const createSchema = z
  .object({
    sourceLedgerAccountId: z.string().min(1),
    // Provide exactly one of these two:
    destinationIdentifier: z.string().min(1).optional(),
    destinationLedgerAccountId: z.string().min(1).optional(),
    amount: z.string().min(1),
    frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]),
    startDate: z.string().min(1), // ISO date(-time), UTC
    endDate: z.string().min(1).nullable().optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as
      | "ACTIVE"
      | "PAUSED"
      | "CANCELLED"
      | "COMPLETED"
      | null;
    const sourceLedgerAccountId = searchParams.get("sourceLedgerAccountId") ?? undefined;

    const transfers = await listRecurringTransfers(orgId, {
      status: status ?? undefined,
      sourceLedgerAccountId,
    });
    return NextResponse.json({ recurringTransfers: transfers.map(serializeRecurringTransfer) });
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

    const transfer = await createRecurringTransfer({
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      ...parsed.data,
    });
    return NextResponse.json({ recurringTransfer: serializeRecurringTransfer(transfer) }, { status: 201 });
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
  if (err instanceof BucketNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof DcaValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[dca] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}