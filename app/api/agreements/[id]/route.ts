// app/api/agreements/[id]/route.ts
//
// GET: read a single agreement mirror (with conditions, stream, recent actions).
// POST: execute an action on this agreement, discriminated by `{ action: ... }`:
//   action = "fund"                amountUsdc, tokenAddress?, approveFirst?
//   action = "activate"            no body
//   action = "cancel"              no body
//   action = "expire"              no body
//   action = "release"             beneficiary, amountUsdc, conditionId?
//   action = "grant-auth"          actor
//   action = "revoke-auth"         actor
//   action = "sync"                re-pulls agreement data from on-chain (no tx)
//   action = "preview-nonce"       actor → returns next nonce for EIP-712 signing

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";

import {
  getAgreement,
  fundAgreementMirror,
  activateAgreementMirror,
  cancelAgreementMirror,
  expireAgreementMirror,
  releaseToMirror,
  grantAuthorizationMirror,
  revokeAuthorizationMirror,
  syncAgreementFromChain,
  previewNonceForActor,
  AgreementNotFoundError,
  ProtocolNotConfiguredError,
  ProtocolValidationError,
} from "@/lib/onchain-agreements/service";

type RouteParams = { params: Promise<{ id: string }> };

// --- Body schemas -------------------------------------------------------

const baseActionSchema = z.object({ action: z.string() });

const fundSchema = baseActionSchema.extend({
  action: z.literal("fund"),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  tokenAddress: z.string().startsWith("0x").optional(),
  approveFirst: z.boolean().optional(),
});

const noBodyActions = z.enum(["activate", "cancel", "expire", "sync"]);
const noBodySchema = baseActionSchema.extend({
  action: z.custom<`${(typeof noBodyActions.options)[number]}`>((v) =>
    noBodyActions.safeParse(v).success
  ),
});

const releaseSchema = baseActionSchema.extend({
  action: z.literal("release"),
  beneficiary: z.string().startsWith("0x"),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  conditionId: z.string().startsWith("0x").optional(),
});

const authSchema = baseActionSchema.extend({
  action: z.enum(["grant-auth", "revoke-auth"]),
  actor: z.string().startsWith("0x"),
});

const nonceSchema = baseActionSchema.extend({
  action: z.literal("preview-nonce"),
  actor: z.string().startsWith("0x"),
});

const postBody = z.discriminatedUnion("action", [
  fundSchema,
  noBodySchema,
  releaseSchema,
  authSchema,
  nonceSchema,
]);

// --- Route handlers -----------------------------------------------------

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const agreement = await getAgreement(orgId, id);
    return NextResponse.json({ agreement });
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
      case "fund": {
        const res = await fundAgreementMirror(actionCtx, id, parsed.data.amountUsdc, {
          approveFirst: parsed.data.approveFirst,
          tokenAddress: parsed.data.tokenAddress,
        });
        return NextResponse.json(res);
      }
      case "activate": {
        return NextResponse.json(await activateAgreementMirror(actionCtx, id));
      }
      case "cancel": {
        return NextResponse.json(await cancelAgreementMirror(actionCtx, id));
      }
      case "expire": {
        return NextResponse.json(await expireAgreementMirror(actionCtx, id));
      }
      case "release": {
        return NextResponse.json(
          await releaseToMirror(actionCtx, id, {
            beneficiary: parsed.data.beneficiary,
            amountUsdc: parsed.data.amountUsdc,
            conditionId: parsed.data.conditionId,
          })
        );
      }
      case "grant-auth": {
        return NextResponse.json(
          await grantAuthorizationMirror(actionCtx, id, parsed.data.actor)
        );
      }
      case "revoke-auth": {
        return NextResponse.json(
          await revokeAuthorizationMirror(actionCtx, id, parsed.data.actor)
        );
      }
      case "sync": {
        const { orgId: syncOrgId } = await requireAuth();
        const synced = await syncAgreementFromChain(syncOrgId, id);
        return NextResponse.json({ agreement: synced });
      }
      case "preview-nonce": {
        const { orgId: nonceOrgId } = await requireAuth();
        const nonce = await previewNonceForActor(nonceOrgId, id, parsed.data.actor);
        return NextResponse.json({ nonce });
      }
    }
  } catch (err) {
    return handleError(err);
  }
}

// --- Error mapper ------------------------------------------------------

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
  console.error("[api/agreements/:id] failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
