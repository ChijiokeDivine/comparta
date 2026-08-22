// app/api/agreements/[id]/stream/route.ts
//
// GET  — stream mirror row (or 404 if none exists) plus claimableAmount
// POST — attach a stream to an existing CREATED/FUNDED agreement   action = "attach"
//      — claim currently-claimable stream balance                   action = "claim"
//      — cancel the stream                                          action = "cancel"

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";

import {
  attachStreamToAgreementMirror,
  claimStreamMirror,
  cancelStreamMirror,
  AgreementNotFoundError,
  ProtocolNotConfiguredError,
  ProtocolValidationError,
} from "@/lib/onchain-agreements/service";

import { claimableAmount, getStream as onchainGetStream } from "@/lib/onchain/stream";

type RouteParams = { params: Promise<{ id: string }> };

const dateOrIso = z.union([z.string().min(1), z.date()]);

const postBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attach"),
    recipient: z.string().startsWith("0x"),
    startTime: dateOrIso,
    endTime: dateOrIso,
    cliff: dateOrIso.optional(),
  }),
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("cancel") }),
]);

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;

    const { prisma } = await import("@/lib/db/prisma");
    const agreement = await prisma.onchainAgreement.findFirst({
      where: { id, orgId },
      include: { stream: true },
    });
    if (!agreement) throw new AgreementNotFoundError("Agreement not found");
    if (!agreement.stream) {
      return NextResponse.json({ stream: null });
    }

    let claimable = "0";
    try {
      const amount = await claimableAmount(agreement.agreementId as any);
      const { toDecimalString } = await import("@/lib/circle/amount");
      claimable = toDecimalString(amount);
    } catch (_) {
      // live rpc not available — don't fail the whole read
    }
    return NextResponse.json({ stream: agreement.stream, claimableAmountUsdc: claimable });
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
    if (parsed.data.action === "attach") {
      const res = await attachStreamToAgreementMirror(actionCtx, id, {
        recipient: parsed.data.recipient,
        startTime: BigInt(Math.floor(new Date(parsed.data.startTime).getTime() / 1000)),
        endTime: BigInt(Math.floor(new Date(parsed.data.endTime).getTime() / 1000)),
        cliff: parsed.data.cliff
          ? BigInt(Math.floor(new Date(parsed.data.cliff).getTime() / 1000))
          : undefined,
      });
      return NextResponse.json(res, { status: 201 });
    }
    if (parsed.data.action === "claim") {
      return NextResponse.json(await claimStreamMirror(actionCtx, id));
    }
    return NextResponse.json(await cancelStreamMirror(actionCtx, id));
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
  console.error("[api/agreements/:id/stream] failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
