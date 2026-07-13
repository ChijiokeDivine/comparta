// app/api/savings/rules/route.ts
//
// GET: list savings rules (optionally filtered by source/target bucket
// or active state). Any authenticated org member. POST: create a rule.
// OWNER/ADMIN only. Mirrors app/api/allocation-rules/route.ts exactly.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import {
  createSavingsRule,
  listSavingsRules,
  SavingsValidationError,
} from "@/lib/savings/service";
import { BucketNotFoundError } from "@/lib/buckets/service";
import { serializeSavingsRule } from "@/lib/savings/serialize";

const createSchema = z
  .object({
    sourceLedgerAccountId: z.string().min(1),
    targetLedgerAccountId: z.string().min(1),
    trigger: z.enum(["PERCENTAGE_OF_INCOME", "ROUND_UP", "FIXED_RECURRING"]),
    // PERCENTAGE_OF_INCOME: "10" (=10%). ROUND_UP: "10.00" (round-up unit,
    // USDC). FIXED_RECURRING: "50.00" (USDC per occurrence).
    value: z.string().min(1),
    scheduleCron: z.string().min(1).optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const sourceLedgerAccountId = searchParams.get("sourceLedgerAccountId") ?? undefined;
    const targetLedgerAccountId = searchParams.get("targetLedgerAccountId") ?? undefined;
    const activeParam = searchParams.get("active");
    const active = activeParam === null ? undefined : activeParam === "true";

    const rules = await listSavingsRules(orgId, { sourceLedgerAccountId, targetLedgerAccountId, active });
    return NextResponse.json({ savingsRules: rules.map(serializeSavingsRule) });
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

    const rule = await createSavingsRule({ orgId: ctx.orgId, ...parsed.data });
    return NextResponse.json({ savingsRule: serializeSavingsRule(rule) }, { status: 201 });
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
  if (err instanceof SavingsValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[savings/rules] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}