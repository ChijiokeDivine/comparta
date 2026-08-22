// app/api/agreements/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requireApprovedOrg,
  UnauthenticatedError,
  KybNotApprovedError,
} from "@/lib/auth/kyb-gate";

import {
  createAgreementMirror,
  createStreamAgreementMirror,
  listAgreements,
  ProtocolNotConfiguredError,
  ProtocolValidationError,
} from "@/lib/onchain-agreements/service";

import type { OnchainAgreementStatus, OnchainAgreementModule } from "@/app/generated/prisma/client";

const VALID_STATUSES = ["CREATED", "FUNDED", "ACTIVE", "SETTLED", "CANCELLED", "EXPIRED"] as const;
const VALID_MODULES = ["NONE", "CONDITIONAL", "STREAM"] as const;

const dateOrIso = z.union([z.string().min(1), z.date()]);

// 1. Define shared core fields as a clean raw object instead of a full schema instance
const coreFields = {
  seed: z.string().max(200).optional(),
  tokenAddress: z.string().startsWith("0x").optional(),
  payerAddress: z.string().startsWith("0x"),
  principalUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  startTime: dateOrIso,
  endTime: dateOrIso,
  metadataHash: z.string().startsWith("0x").optional(),
  initialAuthorized: z.array(z.string().startsWith("0x")).optional(),
  referenceType: z.enum(["INVOICE", "PAYROLL_RUN", "INTERNAL_TRANSFER"]).optional().nullable(),
  referenceId: z.string().min(1).optional().nullable(),
};

// 2. Build plain object variants explicitly for the discriminator tool to evaluate
const createPlainSchema = z.object({
  kind: z.literal("agreement").default("agreement"),
  moduleType: z.enum(VALID_MODULES),
  ...coreFields,
});

const createStreamAgreementSchema = z.object({
  kind: z.literal("stream-agreement"),
  recipientAddress: z.string().startsWith("0x"),
  cliff: dateOrIso.optional(),
  ...coreFields,
});

// 3. This cleanly provides clear type properties to the union handler
const postSchema = z.discriminatedUnion("kind", [
  createPlainSchema,
  createStreamAgreementSchema,
]);

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status")?.toUpperCase();
    const moduleType = searchParams.get("moduleType")?.toUpperCase();
    const limit = Number(searchParams.get("limit") || "50");

    if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: `Invalid status "${status}"` }, { status: 400 });
    }
    if (moduleType && !VALID_MODULES.includes(moduleType as (typeof VALID_MODULES)[number])) {
      return NextResponse.json({ error: `Invalid moduleType "${moduleType}"` }, { status: 400 });
    }
    if (Number.isNaN(limit) || limit < 1 || limit > 200) {
      return NextResponse.json({ error: "limit must be 1..200" }, { status: 400 });
    }

    const agreements = await listAgreements(orgId, {
      status: status as OnchainAgreementStatus | undefined,
      moduleType: moduleType as OnchainAgreementModule | undefined,
      limit,
    });
    return NextResponse.json({ agreements });
  } catch (err) {
    return handleListCreateError(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireApprovedOrg();

    const body = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.kind === "stream-agreement") {
      const { agreement, txHashes } = await createStreamAgreementMirror(
        { orgId: ctx.orgId, userId: ctx.userId },
        parsed.data
      );
      return NextResponse.json({ agreement, txHashes }, { status: 201 });
    }

    // Explicitly destructure data payload properties to satisfy the service compiler requirements safely
    const { kind, ...agreementData } = parsed.data;
    const { agreement, txHash, onchainAgreementId } = await createAgreementMirror(
      { orgId: ctx.orgId, userId: ctx.userId },
      agreementData
    );
    return NextResponse.json(
      { agreement, txHash, onchainAgreementId },
      { status: 201 }
    );
  } catch (err) {
    return handleListCreateError(err);
  }
}

function handleListCreateError(err: unknown) {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof KybNotApprovedError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ProtocolNotConfiguredError) {
    return NextResponse.json(
      { error: "On-chain protocol not configured for this environment", detail: err.message },
      { status: 503 }
    );
  }
  if (err instanceof ProtocolValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[api/agreements] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
