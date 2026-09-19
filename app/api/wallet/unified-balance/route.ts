// app/api/wallet/unified-balance/route.ts
//
// Cross-chain counterpart to app/api/wallet/balance/route.ts. Returns the
// org wallet's Unified Balance (Circle Gateway) broken down by chain —
// confirmed and pending, per lib/circle/unifiedBalance.ts's supported-
// chain list — rather than the single onchain figure that route returns.
// Kept as a separate route (not folded into balance/route.ts) so a slow
// or failing Gateway call never blocks the existing ledger+onchain
// balance response the dashboard already depends on.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { getUnifiedUsdcBalance } from "@/lib/circle/wallets";
import { UNIFIED_BALANCE_SUPPORTED_CHAINS } from "@/lib/circle/unifiedBalance";
import { toDecimalString } from "@/lib/circle/amount";

export async function GET() {
  try {
    const { orgId } = await requireApprovedOrg();

    const wallet = await prisma.wallet.findFirst({ where: { orgId } });
    if (!wallet) {
      return NextResponse.json({ error: "No wallet provisioned for this organization" }, { status: 404 });
    }

    const snapshot = await getUnifiedUsdcBalance(wallet.arcAddress);

    return NextResponse.json({
      address: wallet.arcAddress,
      supportedChains: UNIFIED_BALANCE_SUPPORTED_CHAINS,
      totalConfirmed: toDecimalString(snapshot.totalConfirmed),
      totalPending: toDecimalString(snapshot.totalPending),
      byChain: snapshot.byChain.map((c) => ({
        chain: c.chain,
        confirmed: toDecimalString(c.confirmed),
        pending: toDecimalString(c.pending),
      })),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[wallet/unified-balance] failed", err);
    return NextResponse.json({ error: "Failed to fetch Unified Balance" }, { status: 500 });
  }
}
