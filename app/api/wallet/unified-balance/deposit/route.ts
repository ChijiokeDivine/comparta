// app/api/wallet/unified-balance/deposit/route.ts
//
// Hybrid model C: Fund Unified Balance with user-selected bucket debits.
// Body:
//   {
//     sourceChain: "ARC_TESTNET" | ...,
//     amount: "50.00",
//     allocations: [{ ledgerAccountId, amount }, ...]  // must sum to amount
//   }

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import {
  deriveWalletOnChain,
  ensureWalletDerivedOnDepositChains,
  CircleApiError,
} from "@/lib/circle/wallets";
import { DEPOSIT_SOURCE_SUPPORTED_CHAINS, isDepositSourceSupported } from "@/lib/circle/unifiedBalance";
import {
  fundUnifiedBalance,
  FundUnifiedError,
} from "@/lib/transfers/fundUnifiedBalance";
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
  sourceChain: z.enum(DEPOSIT_SOURCE_SUPPORTED_CHAINS as unknown as [string, ...string[]]),
  amount: z.string().min(1),
  allocations: z
    .array(
      z.object({
        ledgerAccountId: z.string().min(1),
        amount: z.string().min(1),
      })
    )
    .min(1),
});

function isWalletNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("cannot find target wallet") ||
    lower.includes("requested resource not found") ||
    lower.includes("wallet doesn't exist") ||
    lower.includes("not accessible to the caller") ||
    lower.includes("undeployed wallet")
  );
}

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
        {
          error:
            "Invalid request. Provide sourceChain, amount, and allocations[] (bucket + amount) that sum to amount.",
          issues: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const sourceChain = parsed.data.sourceChain as Chain;
    if (!isDepositSourceSupported(sourceChain)) {
      return NextResponse.json(
        { error: `"${sourceChain}" is not a supported deposit source.` },
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
      const errBody = { error: "No wallet provisioned for this organization" };
      await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, errBody, 404);
      return NextResponse.json(errBody, { status: 404 });
    }

    // Ensure Circle can sign on this chain (derive / register).
    try {
      const existing = await prisma.walletChainRegistration.findUnique({
        where: { walletId_chain: { walletId: wallet.id, chain: sourceChain } },
      });
      if (!existing) {
        if (sourceChain === wallet.chain || sourceChain === "ARC_TESTNET") {
          await prisma.walletChainRegistration.upsert({
            where: { walletId_chain: { walletId: wallet.id, chain: sourceChain } },
            create: {
              walletId: wallet.id,
              chain: sourceChain,
              derivedCircleWalletId: wallet.circleWalletId,
            },
            update: { derivedCircleWalletId: wallet.circleWalletId },
          });
        } else {
          await deriveWalletOnChain(
            wallet.id,
            wallet.circleWalletId,
            wallet.arcAddress,
            sourceChain
          );
        }
      }
      void ensureWalletDerivedOnDepositChains(wallet.id).catch((err) =>
        console.warn("[wallet/unified-balance/deposit] background provision failed", err)
      );
    } catch (err) {
      console.error("[wallet/unified-balance/deposit] ensure chain failed", err);
      const errBody = {
        error: `Could not register wallet on ${sourceChain}. Try POST /api/wallet/unified-balance/provision first.`,
      };
      await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, errBody, 502);
      return NextResponse.json(errBody, { status: 502 });
    }

    const result = await fundUnifiedBalance({
      orgId: ctx.orgId,
      sourceChain,
      amount: parsed.data.amount,
      allocations: parsed.data.allocations,
      idempotencyKey,
    });

    const responseBody = {
      deposit: result.deposit,
      debited: result.debited,
    };
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
    if (err instanceof FundUnifiedError) {
      const status =
        err.code === "INSUFFICIENT_LEDGER" || err.code === "INSUFFICIENT_ONCHAIN"
          ? 422
          : err.code === "PROVIDER_ERROR"
            ? 502
            : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    if (err instanceof CircleApiError) {
      console.error("[wallet/unified-balance/deposit] Circle error", err.cause ?? err);
      if (isWalletNotFoundError(err) || isWalletNotFoundError(err.cause)) {
        return NextResponse.json(
          {
            error:
              "Circle could not sign for this wallet on the selected chain. " +
              "Ensure allowanceStrategy is approve (SCA) and the wallet is provisioned.",
          },
          { status: 502 }
        );
      }
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[wallet/unified-balance/deposit] failed", err);
    return NextResponse.json({ error: "Failed to deposit into Unified Balance" }, { status: 500 });
  }
}
