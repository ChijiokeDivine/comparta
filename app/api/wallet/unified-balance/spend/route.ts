// app/api/wallet/unified-balance/spend/route.ts
//
// Wraps lib/transfers/sendUnified.ts's sendUnifiedBalancePayment() with
// HTTP concerns — same shape as app/api/transfers/send/route.ts (auth,
// KYB gate, request validation, required Idempotency-Key header). Kept
// as its own route rather than a branch inside transfers/send/route.ts
// because the request body is materially different (destinationChain +
// a raw toAddress, no toIdentifier) — see sendUnified.ts's module
// docstring for why the underlying function is separate too.

import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { sendUnifiedBalancePayment, SendUnifiedPaymentError } from "@/lib/transfers/sendUnified";
import { UNIFIED_BALANCE_SUPPORTED_CHAINS } from "@/lib/circle/unifiedBalance";
import type { Chain } from "@/app/generated/prisma/client";
import {
  checkAndReserveIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashRequestBody,
  DuplicateRequestError,
} from "@/lib/transfers/idempotency";

const ENDPOINT = "POST /api/wallet/unified-balance/spend";

const spendSchema = z.object({
  fromLedgerAccountId: z.string().min(1),
  toAddress: z.string().min(1),
  // z.enum needs a non-empty tuple literal - UNIFIED_BALANCE_SUPPORTED_CHAINS
  // is typed as readonly Chain[], so cast the tuple shape here rather than
  // hand-duplicating the chain list (which would drift from
  // unifiedBalance.ts's list the moment either one changes).
  destinationChain: z.enum(UNIFIED_BALANCE_SUPPORTED_CHAINS as [string, ...string[]]),
  amount: z.string().min(1),
  memo: z.string().max(500).optional(),
});

const SEND_ERROR_STATUS: Record<string, number> = {
  INVALID_ADDRESS: 422,
  UNSUPPORTED_CHAIN: 422,
  INVALID_AMOUNT: 422,
  INSUFFICIENT_BALANCE: 422,
  PROVIDER_ERROR: 502,
  ACCOUNT_NOT_FOUND: 404,
};

export async function POST(req: Request) {
  let ctx: { orgId: string } | undefined;
  let idempotencyKey: string | undefined;

  try {
    ctx = await requireApprovedOrg();

    idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Missing required Idempotency-Key header." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = spendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const requestHash = hashRequestBody(parsed.data);

    const replay = await checkAndReserveIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, requestHash);
    if (replay) {
      return NextResponse.json(replay.responseBody, { status: replay.responseStatus });
    }

    const result = await sendUnifiedBalancePayment({
      orgId: ctx.orgId,
      fromLedgerAccountId: parsed.data.fromLedgerAccountId,
      toAddress: parsed.data.toAddress,
      destinationChain: parsed.data.destinationChain as Chain, // validated against UNIFIED_BALANCE_SUPPORTED_CHAINS above
      amount: parsed.data.amount,
      memo: parsed.data.memo,
      referenceType: "ONCHAIN_TX",
      referenceId: nanoid(),
      idempotencyKey: `unified-send-${idempotencyKey}`, // namespaced so it can never collide with another feature's key
    });

    const responseBody = { transfer: result };
    await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, responseBody, 200);

    return NextResponse.json(responseBody);
  } catch (err) {
    if (ctx && idempotencyKey) {
      await failIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey);
    }

    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof DuplicateRequestError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof SendUnifiedPaymentError) {
      const status = SEND_ERROR_STATUS[err.code] ?? 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[wallet/unified-balance/spend] failed", err);
    return NextResponse.json({ error: "Failed to send payment" }, { status: 500 });
  }
}
