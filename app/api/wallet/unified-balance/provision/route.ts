// app/api/wallet/unified-balance/provision/route.ts
//
// One-time (but safely repeatable) backfill for orgs whose wallet was
// created before multi-chain deposits existed - registers the wallet's
// existing address on Ethereum Sepolia / Base Sepolia / Arbitrum Sepolia
// via lib/circle/wallets.ts#ensureWalletDerivedOnDepositChains. New orgs
// get this automatically at provisioning time (see lib/org/provisioning.ts)
// and never need to call this; it exists for wallets provisioned before
// that wiring existed.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { ensureWalletDerivedOnDepositChains } from "@/lib/circle/wallets";

export async function POST() {
  try {
    const { orgId } = await requireApprovedOrg();

    const wallet = await prisma.wallet.findFirst({ where: { orgId } });
    if (!wallet) {
      return NextResponse.json({ error: "No wallet provisioned for this organization" }, { status: 404 });
    }

    const results = await ensureWalletDerivedOnDepositChains(wallet.id);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[wallet/unified-balance/provision] failed", err);
    return NextResponse.json({ error: "Failed to provision additional chains" }, { status: 500 });
  }
}
