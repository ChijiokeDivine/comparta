// app/api/transfers/send/route.ts
//
// Wraps lib/transfers/send.ts's sendPayment() with HTTP concerns: auth,
// KYB gate, request validation, and API-level idempotency via an
// Idempotency-Key header (required — this endpoint moves real money, so
// there is no "safe default" for a missing key; callers must supply one
// per logical send attempt and reuse it verbatim on retry).

import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { sendPayment, SendPaymentError } from "@/lib/transfers/send";
import {
  checkAndReserveIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashRequestBody,
  DuplicateRequestError,
} from "@/lib/transfers/idempotency";

const ENDPOINT = "POST /api/transfers/send";

const sendSchema = z.object({
  fromLedgerAccountId: z.string().min(1),
  toIdentifier: z.string().min(1),
  amount: z.string().min(1),
  memo: z.string().max(500).optional(),
});

const SEND_ERROR_STATUS: Record<string, number> = {
  INVALID_RECIPIENT: 422,
  SELF_SEND: 422,
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
    const parsed = sendSchema.safeParse(body);
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

    const result = await sendPayment({
      orgId: ctx.orgId,
      fromLedgerAccountId: parsed.data.fromLedgerAccountId,
      toIdentifier: parsed.data.toIdentifier,
      amount: parsed.data.amount,
      memo: parsed.data.memo,
      referenceType: "ONCHAIN_TX",
      referenceId: nanoid(),
      idempotencyKey: `send-${idempotencyKey}`, // namespaced so it can never collide with a Circle key from another feature
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
    if (err instanceof SendPaymentError) {
      const status = SEND_ERROR_STATUS[err.code] ?? 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[transfers/send] failed", err);
    return NextResponse.json({ error: "Failed to send payment" }, { status: 500 });
  }
}