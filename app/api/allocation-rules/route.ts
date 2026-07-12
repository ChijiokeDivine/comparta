// app/api/allocation-rules/route.ts
//
// GET: list allocation rules (optionally filtered by source bucket /
// active state). Any authenticated org member. POST: create a rule.
// OWNER/ADMIN only.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  createAllocationRule,
  listAllocationRules,
  AllocationRuleValidationError,
} from "@/lib/allocationRules/service";
import { BucketNotFoundError } from "@/lib/buckets/service";
import { serializeAllocationRule } from "@/lib/allocationRules/serialize";

const createSchema = z
  .object({
    sourceLedgerAccountId: z.string().min(1),
    targetLedgerAccountId: z.string().min(1),
    ruleType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    // decimal string: "20" (=20%) for PERCENTAGE, "150.00" (USDC) for FIXED_AMOUNT
    value: z.string().min(1),
    trigger: z.enum(["ON_INCOMING_PAYMENT", "SCHEDULED"]).optional(),
    scheduleCron: z.string().min(1).optional(),
    priority: z.number().int().optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const sourceLedgerAccountId = searchParams.get("sourceLedgerAccountId") ?? undefined;
    const activeParam = searchParams.get("active");
    const active = activeParam === null ? undefined : activeParam === "true";

    const rules = await listAllocationRules(orgId, { sourceLedgerAccountId, active });
    return NextResponse.json({ allocationRules: rules.map(serializeAllocationRule) });
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

    const rule = await createAllocationRule({ orgId: ctx.orgId, ...parsed.data });
    return NextResponse.json({ allocationRule: serializeAllocationRule(rule) }, { status: 201 });
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
    return NextResponse.json({ error: "One or both buckets were not found on this organization" }, { status: 404 });
  }
  if (err instanceof AllocationRuleValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[allocation-rules] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
