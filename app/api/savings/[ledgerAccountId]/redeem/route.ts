// app/api/savings/[ledgerAccountId]/redeem/route.ts
//
// POST: redeem USYC back to USDC, in full or in part. ALWAYS returns
// PENDING/PROCESSING request(s) with a 202 — never a synchronous "done" —
// see lib/savings/yield.ts's module docstring for why redemption is
// always modeled as async, even though USYC settlement is typically
// fast. The UI should poll GET
// /api/savings/:ledgerAccountId/redeem/:requestId for each returned
// request's terminal state, or re-fetch GET /api/savings/:ledgerAccountId
// for the bucket's overall pendingRedemptions list.
//
// OWNER/ADMIN only, same gate as every other bucket-mutating action.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  requestRedemption,
  YieldError,
  YieldNotEnabledError,
  InsufficientYieldPositionError,
} from "@/lib/savings/yield";
import { serializeYieldRedemptionRequest } from "@/lib/savings/serialize";
import { BucketNotFoundError } from "@/lib/buckets/service";

const redeemSchema = z
  .object({
    // Decimal USYC amount, or "all"/omitted to redeem every available
    // position in full.
    usycAmount: z.string().min(1).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: Promise<{ ledgerAccountId: string }> }) {
  try {
    const { ledgerAccountId } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx, ledgerAccountId);

    const body = await req.json().catch(() => ({}));
    const parsed = redeemSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const result = await requestRedemption({
      orgId: ctx.orgId,
      ledgerAccountId,
      usycAmount: parsed.data.usycAmount,
    });

    return NextResponse.json(
      {
        redemptionRequests: result.requests.map(serializeYieldRedemptionRequest),
        totalUsycAmountRequested: result.totalUsycAmountRequested.toString(),
        status: "PROCESSING",
      },
      { status: 202 }
    );
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
  if (err instanceof InsufficientYieldPositionError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  if (err instanceof YieldNotEnabledError || err instanceof YieldError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[savings/:ledgerAccountId/redeem] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}