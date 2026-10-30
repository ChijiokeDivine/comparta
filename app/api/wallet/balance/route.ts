// app/api/wallet/balance/route.ts
//
// Returns the authenticated org's ledger bucket breakdown (Postgres,
// fast) alongside the live onchain USDC balance (Circle, source of
// truth). These should match within tolerance — if they diverge, the
// periodic reconciliation job (jobs/workers/reconciliation.worker.ts)
// will flag it, but this route surfaces the raw numbers for debugging.
//
// Also includes the fiat valuation of the ledger total in the org's
// preferred currency (see lib/fx/valuation.ts). This is the endpoint
// the dashboard should prefer for a single "balance + fiat" call.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { LedgerAccount } from "@/app/generated/prisma/client";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { getUsdcBalance } from "@/lib/circle/wallets";
import { getNetworkProfile, resolveAppNetwork } from "@/lib/config/network";
import { getBalance } from "@/lib/ledger/engine";
import { toDecimalString } from "@/lib/circle/amount";
import {
  valueUsdcInPreferredCurrency,
  type FiatValuationResult,
} from "@/lib/fx/valuation";

export async function GET() {
  try {
    const { orgId } = await requireApprovedOrg();

    const wallet = await prisma.wallet.findFirst({
      where: { orgId, chain: getNetworkProfile(resolveAppNetwork()).chain },
    });
    if (!wallet) {
      return NextResponse.json({ error: "No wallet provisioned for this organization" }, { status: 404 });
    }

    const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { orgId } });

    const [onchainUsdc, rawBucketBalances] = await Promise.all([
      // A Circle read failure must not take down the whole balance response:
      // the Postgres ledger is still valid. Log the cause so a stale/wrong-
      // network wallet is diagnosable instead of silently reading "—".
      getUsdcBalance(wallet.circleWalletId).catch((err) => {
        console.error("[wallet/balance] onchain USDC read failed", {
          orgId,
          circleWalletId: wallet.circleWalletId,
          chain: wallet.chain,
          error: err instanceof Error ? err.message : err,
        });
        return null;
      }),
      Promise.all(
        ledgerAccounts.map(async (account: LedgerAccount) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          balanceMicroUsdc: await getBalance(account.id),
        }))
      ),
    ]);

    const ledgerTotal = rawBucketBalances.reduce((sum, b) => sum + b.balanceMicroUsdc, 0n);
    const bucketBalances = rawBucketBalances.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      balance: toDecimalString(b.balanceMicroUsdc),
    }));

    const fiatVal = await valueUsdcInPreferredCurrency({
      orgId,
      usdcMicroAmount: ledgerTotal,
    });
    const fiat: FiatValuationResult = fiatVal;

    return NextResponse.json({
      wallet: { arcAddress: wallet.arcAddress, chain: wallet.chain },
      onchainUsdcBalance: onchainUsdc,
      ledgerTotalUsdc: toDecimalString(ledgerTotal),
      buckets: bucketBalances,
      usdc: { amount: toDecimalString(ledgerTotal) },
      fiat,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[wallet/balance] failed", err);
    return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
  }
}
