// app/api/buckets/[id]/route.ts
//
// GET: single bucket detail (balance + sparkline). Any authenticated org
// member. PATCH: rename. OWNER/ADMIN only.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  getBucketDetail,
  renameBucket,
  BucketNotFoundError,
  BucketValidationError,
  BucketArchivedError,
} from "@/lib/buckets/service";

const renameSchema = z.object({ name: z.string().min(1).max(100) }).strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const bucket = await getBucketDetail(orgId, id);
    return NextResponse.json({ bucket });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApprovedOrg();
    assertCanManageBucket(ctx, id);

    const body = await req.json().catch(() => null);
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const bucket = await renameBucket(ctx.orgId, id, parsed.data.name);
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
  if (err instanceof BucketValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[buckets/:id] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}