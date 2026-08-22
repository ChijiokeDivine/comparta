// app/api/agreements/[id]/conditions/[conditionId]/route.ts
//
// GET: read one condition row (mirror)
// POST: action = "authorize"    | authorize a condition (direct call or via operator EIP-712 sig)
//       action = "authorize-sig" | sign an operator EIP-712 auth and submit it
//       action = "release"      | release funds (anyone after auth + time-gates)

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";

import {
  authorizeConditionMirror,
  releaseConditionMirror,
  AgreementNotFoundError,
  ProtocolNotConfiguredError,
  ProtocolValidationError,
} from "@/lib/onchain-agreements/service";

type RouteParams = { params: Promise<{ id: string; conditionId: string }> };

const postBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("authorize"),
    useBackendOperatorSignature: z.boolean().optional(),
  }),
  z.object({ action: z.literal("release") }),
]);

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id, conditionId } = await params;
    const { prisma } = await import("@/lib/db/prisma");
    const cond = await prisma.onchainCondition.findFirst({
      where: { orgId, agreement: { id, orgId }, conditionId },
    });
    if (!cond) {
      return NextResponse.json({ error: "Condition not found" }, { status: 404 });
    }
    return NextResponse.json({ condition: cond });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const ctx = await requireApprovedOrg();
    const { id, conditionId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = postBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const actionCtx = { orgId: ctx.orgId, userId: ctx.userId };
    if (parsed.data.action === "authorize") {
      const res = await authorizeConditionMirror(actionCtx, id, conditionId, {
        useBackendOperatorSignature: parsed.data.useBackendOperatorSignature,
      });
      return NextResponse.json(res);
    }
    const res = await releaseConditionMirror(actionCtx, id, conditionId);
    return NextResponse.json(res);
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
  if (err instanceof AgreementNotFoundError) {
    return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
  }
  if (err instanceof ProtocolNotConfiguredError) {
    return NextResponse.json(
      { error: "On-chain protocol not configured", detail: err.message },
      { status: 503 }
    );
  }
  if (err instanceof ProtocolValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[api/agreements/:id/conditions/:conditionId] failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
