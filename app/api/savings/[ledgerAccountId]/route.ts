// app/api/savings/[ledgerAccountId]/route.ts
//
// GET: savings bucket overview — liquid vs. deployed balance split,
// accrued yield, current APY, monthly projection, active USYC positions,
// and pending redemptions. Shaped so the UI can render the whole detail
// view directly from this response. Any authenticated org member.
//
// PATCH: enable/configure yield on a bucket (isYieldEnabled,
// yieldAllocationPct, minimumBalanceFloor). OWNER/ADMIN only, same gate
// as every other bucket-mutating action (see lib/auth/canManageBucket.ts).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { getSavingsBucketOverview } from "@/lib/savings/overview";
import { setBucketYieldConfig, SavingsValidationError } from "@/lib/savings/service";
import { BucketNotFoundError, BucketArchivedError } from "@/lib/buckets/service";

const configSchema = z
  .object({
    isYieldEnabled: z.boolean(),
    // "80" = deploy 80% of every fresh sweep into USYC, keep 20% liquid.
    yieldAllocationPct: z.string().min(1).optional(),
    // Decimal USDC string — the floor this bucket must never be swept below.
    minimumBalanceFloor: z.string().min(1).optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: Promise<{ ledgerAccountId: string }> }) {
  try {
    const { ledgerAccountId } = await params;
    const { orgId } = await requireAuth();
    const overview = await getSavingsBucketOverview(orgId, ledgerAccountId);
    return NextResponse.json({ savingsBucket: overview });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ ledgerAccountId: string }> }) {
  try {
    const { ledgerAccountId } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx, ledgerAccountId);

    const body = await req.json().catch(() => null);
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const bucket = await setBucketYieldConfig(ctx.orgId, ledgerAccountId, parsed.data);
    return NextResponse.json({ bucket });
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
  if (err instanceof BucketArchivedError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof SavingsValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[savings/:ledgerAccountId] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}