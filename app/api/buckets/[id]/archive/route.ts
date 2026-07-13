// app/api/buckets/[id]/archive/route.ts
//
// POST: archive a bucket. OWNER/ADMIN only. Blocked (409, with a
// machine-readable reason) if the bucket still holds a balance or has
// live dependents (active allocation rules, live payment links, the
// org's default receiving bucket — see lib/buckets/dependencies.ts,
// extensible by future Payroll/Savings modules without touching this
// route).

import { NextResponse } from "next/server";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  archiveBucket,
  BucketNotFoundError,
  BucketHasBalanceError,
  BucketHasDependenciesError,
} from "@/lib/buckets/service";
import { toDecimalString } from "@/lib/circle/amount";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx, id);

    const bucket = await archiveBucket(ctx.orgId, id, ctx.userId);
    return NextResponse.json({ bucket });
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
    if (err instanceof BucketNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof BucketHasBalanceError) {
      return NextResponse.json(
        { error: err.message, reason: "NONZERO_BALANCE", balance: toDecimalString(err.balance) },
        { status: 409 }
      );
    }
    if (err instanceof BucketHasDependenciesError) {
      return NextResponse.json(
        { error: err.message, reason: "HAS_DEPENDENCIES", dependencies: err.dependencies },
        { status: 409 }
      );
    }
    console.error("[buckets/:id/archive] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}