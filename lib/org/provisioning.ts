// lib/org/provisioning.ts
//
// Provisions an org's single Circle Developer-Controlled Wallet on Arc,
// then creates the four default LedgerAccount buckets (Operating, Tax
// Reserve, Payroll, Savings), all backed by that one wallet.
//
// This used to live inline in app/api/org/kyb/approve/route.ts. It's
// pulled out here so app/api/auth/register/route.ts can call the exact
// same logic when DEMO_KYB_APPROVED is on (see lib/config/demoMode.ts)
// - new signups get a wallet immediately instead of waiting for a KYB
// approval that, in demo mode, never actually happens as a separate step.
//
// Idempotent by design: if a wallet already exists for the org, this is
// a no-op that returns the existing wallet. That matters because BOTH
// callers can reach it for the same org depending on how demo mode is
// toggled over the org's lifetime - e.g. an org provisioned at signup
// under demo mode must never be re-provisioned (and billed a second
// Circle wallet) if /api/org/kyb/approve is ever also called for it.
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { createWalletForOrg, ensureWalletDerivedOnDepositChains } from "@/lib/circle/wallets";
import type { LedgerAccount, Wallet } from "@/app/generated/prisma/client";

const DEFAULT_LEDGER_BUCKETS = [
  { name: "Operating", type: "OPERATING" as const },
  { name: "Tax Reserve", type: "RESERVE" as const },
  { name: "Payroll", type: "PAYROLL" as const },
  { name: "Savings", type: "SAVINGS" as const },
];

export interface ProvisionOrgWalletResult {
  wallet: Wallet;
  ledgerAccounts: LedgerAccount[];
  alreadyProvisioned: boolean;
}

export async function provisionOrgWallet(orgId: string): Promise<ProvisionOrgWalletResult> {
  const existing = await prisma.wallet.findFirst({ where: { orgId } });
  if (existing) {
    const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { orgId, walletId: existing.id } });
    return { wallet: existing, ledgerAccounts, alreadyProvisioned: true };
  }

  // Circle call happens outside the DB transaction (it's a network call to
  // a third party and shouldn't hold a Postgres transaction open); if the
  // subsequent DB writes fail we log loudly rather than silently orphaning
  // a Circle wallet with no local record.
  const circleWallet = await createWalletForOrg(orgId);

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const walletRow = await tx.wallet.create({
        data: {
          orgId,
          circleWalletId: circleWallet.circleWalletId,
          arcAddress: circleWallet.arcAddress,
          chain: circleWallet.chain === "ARC" ? "ARC_MAINNET" : "ARC_TESTNET",
        },
      });

      const ledgerAccounts = await Promise.all(
        DEFAULT_LEDGER_BUCKETS.map((bucket) =>
          tx.ledgerAccount.create({
            data: {
              orgId,
              walletId: walletRow.id,
              name: bucket.name,
              type: bucket.type,
              isYieldEnabled: true,
              yieldAllocationPct: 10000,
            },
          })
        )
      );

      return { walletRow, ledgerAccounts };
    });

    // Best-effort: registers this wallet's address on the non-Arc deposit
    // source chains too (see lib/circle/wallets.ts#ensureWalletDerivedOnDepositChains
    // and lib/circle/unifiedBalance.ts's module docstring for why this is
    // needed at all). Deliberately NOT inside the transaction above and
    // never allowed to fail org provisioning - a new org should never be
    // blocked from existing because Circle's derive-wallet call hiccuped.
    // A failure here just means those chains stay un-derived until the
    // next call to POST /api/wallet/unified-balance/provision (the same
    // backfill path existing orgs use), which is safe to re-run.
    try {
      await ensureWalletDerivedOnDepositChains(result.walletRow.id);
    } catch (err) {
      console.error(
        `[provisioning] Wallet ${result.walletRow.id} created, but deriving it onto additional ` +
          `deposit-source chains failed - it can be retried via POST /api/wallet/unified-balance/provision.`,
        err
      );
    }

    return { wallet: result.walletRow, ledgerAccounts: result.ledgerAccounts, alreadyProvisioned: false };
  } catch (err) {
    console.error(
      `[provisioning] CRITICAL: Circle wallet ${circleWallet.circleWalletId} (${circleWallet.arcAddress}) ` +
        `was created for org ${orgId} but the follow-up DB write failed. Manual reconciliation needed.`,
      err
    );
    throw err;
  }
}