// app/api/paj/offramp/route.ts
// Opens a USDC → naira order and funds it from a bucket. Requires an
// Idempotency-Key header: retries replay the stored response instead of
// opening a second order and sending a second on-chain transfer.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { createOfframpOrder } from "@/lib/paj/service";
import { pajErrorResponse } from "@/lib/paj/http";
import {
  checkAndReserveIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashRequestBody,
  DuplicateRequestError,
} from "@/lib/transfers/idempotency";

const ENDPOINT = "POST /api/paj/offramp";

const schema = z.object({
  fromLedgerAccountId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: z.string().min(1),
  memo: z.string().max(500).optional(),
});

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
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const requestHash = hashRequestBody(parsed.data);
    const replay = await checkAndReserveIdempotencyKey(
      ctx.orgId,
      ENDPOINT,
      idempotencyKey,
      requestHash
    );
    if (replay) {
      return NextResponse.json(replay.responseBody, {
        status: replay.responseStatus,
      });
    }

    const order = await createOfframpOrder({
      orgId: ctx.orgId,
      fromLedgerAccountId: parsed.data.fromLedgerAccountId,
      bankAccountId: parsed.data.bankAccountId,
      amount: parsed.data.amount,
      memo: parsed.data.memo,
      idempotencyKey,
    });

    const responseBody = { order };
    await completeIdempotencyKey(
      ctx.orgId,
      ENDPOINT,
      idempotencyKey,
      responseBody,
      201
    );
    return NextResponse.json(responseBody, { status: 201 });
  } catch (err) {
    if (ctx && idempotencyKey && !(err instanceof DuplicateRequestError)) {
      await failIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey);
    }
    if (err instanceof DuplicateRequestError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return pajErrorResponse(err);
  }
}
