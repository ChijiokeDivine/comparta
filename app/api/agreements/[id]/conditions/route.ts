// app/api/agreements/[id]/conditions/route.ts
//
// GET /api/agreements/:id/conditions — list conditions for an agreement
// POST /api/agreements/:id/conditions — register conditions (action=register)
//   or batch-authorize existing ones (action=authorize-many)

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";

import {
  listConditions,
  registerConditionsMirror,
  AgreementNotFoundError,
  ProtocolNotConfiguredError,
  ProtocolValidationError,
} from "@/lib/onchain-agreements/service";

type RouteParams = { params: Promise<{ id: string }> };

const dateOrIso = z.union([z.string().min(1), z.date()]);

const conditionInput = z.object({
  conditionId: z.union([z.string().startsWith("0x"), z.instanceof(Uint8Array)]),
  amount: z.union([z.string().regex(/^\d+$/), z.number().int(), z.bigint()]),
  beneficiaries: z.array(z.string().startsWith("0x")).min(1),
  earliestRelease: dateOrIso.optional(),
  deadline: dateOrIso.optional(),
});

const registerSchema = z.object({
  action: z.literal("register"),
  conditions: z.array(conditionInput).min(1),
});

const postBody = z.discriminatedUnion("action", [registerSchema]);

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const conditions = await listConditions(orgId, id);
    return NextResponse.json({ conditions });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const ctx = await requireApprovedOrg();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = postBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const actionCtx = { orgId: ctx.orgId, userId: ctx.userId };
    switch (parsed.data.action) {
      case "register": {
        const res = await registerConditionsMirror(actionCtx, id, parsed.data);
        return NextResponse.json(res, { status: 201 });
      }
    }
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
  console.error("[api/agreements/:id/conditions] failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
