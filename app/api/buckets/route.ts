// app/api/buckets/route.ts
//
// GET: dashboard read model — every bucket for the org with current
// balance and a 30-day sparkline. Available to any authenticated org
// member (view-only data).
// POST: create a custom bucket. OWNER/ADMIN only.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  createBucket,
  listBucketsWithBalances,
  BucketValidationError,
} from "@/lib/buckets/service";

const LEDGER_ACCOUNT_TYPES = ["OPERATING", "RESERVE", "PAYROLL", "SAVINGS", "CUSTOM"] as const;

const createSchema = z
  .object({
    name: z.string().min(1).max(100),
    type: z.enum(LEDGER_ACCOUNT_TYPES).optional(),
    walletId: z.string().min(1).optional(),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get("includeArchived") === "true";
    const includeSparkline = searchParams.get("includeSparkline") !== "false"; // default true

    const buckets = await listBucketsWithBalances(orgId, { includeArchived, includeSparkline });

    return NextResponse.json({ buckets });
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

    const bucket = await createBucket({ orgId: ctx.orgId, ...parsed.data });
    return NextResponse.json({ bucket }, { status: 201 });
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
  if (err instanceof BucketValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[buckets] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
