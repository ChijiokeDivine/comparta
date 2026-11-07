// app/api/wallet/route.ts
//
// POST: creates (or returns) the authenticated org's Circle wallet on the
// active network. Idempotent — calling it again when a wallet already
// exists just returns that wallet.
//
// This is the explicit "Create wallet" action surfaced on the dashboard
// and wallet page when no wallet exists. Signup no longer provisions a
// wallet automatically. Existing buckets created at signup are attached
// to the wallet by provisionOrgWallet.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { provisionOrgWallet } from "@/lib/org/provisioning";

export async function POST() {
  try {
    const { orgId } = await requireAuth();
    const result = await provisionOrgWallet(orgId);

    return NextResponse.json({
      wallet: {
        id: result.wallet.id,
        arcAddress: result.wallet.arcAddress,
        chain: result.wallet.chain,
      },
      ledgerAccounts: result.ledgerAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
      })),
      alreadyProvisioned: result.alreadyProvisioned,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[wallet] create failed", err);
    return NextResponse.json(
      { error: "We couldn't create your wallet right now. Please try again in a moment." },
      { status: 500 }
    );
  }
}
