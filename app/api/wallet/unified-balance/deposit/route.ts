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
// IMPORTANT: Circle will not sign a deposit on a chain where this address
// is not registered as a Developer-Controlled Wallet. Before depositing we
// always ensureWalletDerivedOnDepositChains / deriveWalletOnChain for the
// source chain — otherwise you get a opaque 404
// "Cannot find target wallet in the system" from sign/typedData.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import {
  depositIntoUnifiedBalance,
  deriveWalletOnChain,
  ensureWalletDerivedOnDepositChains,
  CircleApiError,
} from "@/lib/circle/wallets";
import {
  DEPOSIT_SOURCE_SUPPORTED_CHAINS,
  isDepositSourceSupported,
} from "@/lib/circle/unifiedBalance";
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

// Only chains we can actually sign deposits from (requires a confirmed
// Developer-Controlled Wallets blockchain code). HyperEVM is a spend
// destination only — see DEPOSIT_SOURCE_SUPPORTED_CHAINS.
const depositSchema = z.object({
  sourceChain: z.enum(DEPOSIT_SOURCE_SUPPORTED_CHAINS as unknown as [string, ...string[]]),
  amount: z.string().min(1),
});

function isWalletNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("cannot find target wallet") ||
    lower.includes("requested resource not found") ||
    lower.includes("wallet doesn't exist") ||
    lower.includes("not accessible to the caller")
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
            "Invalid request. sourceChain must be one of ARC_TESTNET, ETH_SEPOLIA, BASE_SEPOLIA, ARBITRUM_SEPOLIA.",
          issues: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const sourceChain = parsed.data.sourceChain as Chain;
    if (!isDepositSourceSupported(sourceChain)) {
      const errBody = {
        error: `"${sourceChain}" is not supported as a deposit source. Use Arc, Ethereum Sepolia, Base Sepolia, or Arbitrum Sepolia.`,
      };
      return NextResponse.json(errBody, { status: 400 });
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

    let amountSmallestUnit: bigint;
    try {
      amountSmallestUnit = toSmallestUnit(parsed.data.amount);
    } catch {
      const errBody = { error: `"${parsed.data.amount}" isn't a valid USDC amount.` };
      await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, errBody, 422);
      return NextResponse.json(errBody, { status: 422 });
    }

    // Circle will not sign on a chain where this address isn't registered.
    // Derive (idempotent) before deposit so we don't surface a raw 404 from
    // sign/typedData. Also backfill any other deposit-source chains so the
    // next deposit is ready without another round-trip.
    try {
      const existing = await prisma.walletChainRegistration.findUnique({
        where: { walletId_chain: { walletId: wallet.id, chain: sourceChain } },
      });
      if (!existing) {
        if (sourceChain === wallet.chain || sourceChain === "ARC_TESTNET") {
          // Home chain: register the existing circleWalletId without a
          // derive call (createWalletForOrg already provisioned it).
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
      // Best-effort: register other deposit chains in the background of this
      // request so future deposits don't need a separate provision call.
      void ensureWalletDerivedOnDepositChains(wallet.id).catch((err) =>
        console.warn("[wallet/unified-balance/deposit] background provision failed", err)
      );
    } catch (err) {
      console.error("[wallet/unified-balance/deposit] failed to ensure wallet on", sourceChain, err);
      const errBody = {
        error:
          `Could not register this wallet on ${sourceChain} with Circle. ` +
          `Try POST /api/wallet/unified-balance/provision, then deposit again. ` +
          `(${err instanceof Error ? err.message : "unknown error"})`,
      };
      await completeIdempotencyKey(ctx.orgId, ENDPOINT, idempotencyKey, errBody, 502);
      return NextResponse.json(errBody, { status: 502 });
    }

    const result = await depositIntoUnifiedBalance(
      wallet.arcAddress,
      amountSmallestUnit,
      sourceChain
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
      if (isWalletNotFoundError(err) || isWalletNotFoundError(err.cause)) {
        return NextResponse.json(
          {
            error:
              "Circle could not find a signable wallet for this address on the selected chain. " +
              "Open Wallet → Fund Unified Balance after running provision " +
              "(POST /api/wallet/unified-balance/provision), or confirm CIRCLE_API_KEY / " +
              "CIRCLE_ENTITY_SECRET match the environment that created this wallet. " +
              "Also ensure the source chain has plain USDC and the wallet was created under this API key.",
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
