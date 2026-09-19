// app/api/wallet/unified-balance/deposit/route.ts
//
// Triggers depositIntoUnifiedBalance() (lib/circle/wallets.ts) — the step
// that moves USDC already sitting at the wallet's address on a given
// chain INTO Circle Gateway's Unified Balance. Without calling this,
// funds that arrived at the address (via Send, or an external transfer
// on one of the new chains) will never appear in GET
// /api/wallet/unified-balance, no matter how long you wait — see
// lib/circle/unifiedBalance.ts's module docstring for why.
//
// Kept as its own route (mirroring spend/route.ts's shape: auth, KYB
// gate, Idempotency-Key header, zod validation) rather than folded into
// GET unified-balance/route.ts, since this one moves funds on-chain and
// the other is a pure read.
//
// NOT YET WIRED: nothing calls this automatically when USDC lands at the
// wallet's address on a new chain — there's no webhook or poller for that
// (see chainMapping.ts). This route exists so the deposit step CAN be
// triggered (manually, or by a future poller); it doesn't detect deposits
// itself.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { depositIntoUnifiedBalance, CircleApiError } from "@/lib/circle/wallets";
import { UNIFIED_BALANCE_SUPPORTED_CHAINS } from "@/lib/circle/unifiedBalance";
import { toSmallestUnit } from "@/lib/circle/amount";
import type { Chain } from "@/app/generated/prisma/client";
import {
  checkAndReserveIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashRequestBody,
  DuplicateRequestError,
} from "@/lib/transfers/idempotency";

const ENDPOINT = "POST /api/wallet/unified-balance/deposit";

const depositSchema = z.object({
  sourceChain: z.enum(UNIFIED_BALANCE_SUPPORTED_CHAINS as [string, ...string[]]),
  amount: z.string().min(1),
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
    const parsed = depositSchema.safeParse(body);
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

    const wallet = await prisma.wallet.findFirst({ where: { orgId: ctx.orgId } });
    if (!wallet) {
      const body = { error: "No wallet provisioned for this organization" };
      await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, body, 404);
      return NextResponse.json(body, { status: 404 });
    }

    let amountSmallestUnit: bigint;
    try {
      amountSmallestUnit = toSmallestUnit(parsed.data.amount);
    } catch {
      const body = { error: `"${parsed.data.amount}" isn't a valid USDC amount.` };
      await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, body, 422);
      return NextResponse.json(body, { status: 422 });
    }

    const result = await depositIntoUnifiedBalance(
      wallet.arcAddress,
      amountSmallestUnit,
      parsed.data.sourceChain as Chain
    );

    const responseBody = { deposit: result };
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
    if (err instanceof CircleApiError) {
      console.error("[wallet/unified-balance/deposit] Circle/Gateway error", err.cause ?? err);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[wallet/unified-balance/deposit] failed", err);
    return NextResponse.json({ error: "Failed to deposit into Unified Balance" }, { status: 500 });
  }
}
