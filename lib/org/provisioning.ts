// lib/org/provisioning.ts
//
// Provisions an org's Circle Developer-Controlled Wallet(s) for Unified
// Balance source chains (Arc + ETH/Base/Arbitrum Sepolia, etc.), then
// creates the four default LedgerAccount buckets (Operating, Tax Reserve,
// Payroll, Savings), all backed by the primary Arc Wallet row.
//
// createWalletForOrg() now creates one SCA per Unified Balance chain under
// the same wallet set + refId=orgId so addresses stay consistent across
// EVM chains. We persist:
//   - one Wallet row (Arc = primary treasury / ledger anchor)
//   - one WalletChain row per provisioned chain (needed so App Kit can
//     sign deposits on non-Arc chains)
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
// Multi-chain backfill for *existing* orgs is a separate script
// (scripts/backfill-unified-balance-wallets.ts), not done here.
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { createWalletForOrg } from "@/lib/circle/wallets";
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
    const ledgerAccounts = await prisma.ledgerAccount.findMany({
      where: { orgId, walletId: existing.id },
    });
    return { wallet: existing, ledgerAccounts, alreadyProvisioned: true };
  }

  // Circle call happens outside the DB transaction (it's a network call to
  // a third party and shouldn't hold a Postgres transaction open); if the
  // subsequent DB writes fail we log loudly rather than silently orphaning
  // Circle wallet(s) with no local record.
  const circleWallet = await createWalletForOrg(orgId);

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const walletRow = await tx.wallet.create({
        data: {
          orgId,
          circleWalletId: circleWallet.circleWalletId,
          arcAddress: circleWallet.arcAddress,
          // Prefer explicit chain from the Arc entry when present; fall back
          // to the Circle blockchain code string ("ARC" vs "ARC-TESTNET").
          chain:
            circleWallet.chainWallets.find(
              (c) => c.chain === "ARC_TESTNET" || c.chain === "ARC_MAINNET"
            )?.chain ??
            (circleWallet.chain === "ARC" || circleWallet.chain === "ARC-MAINNET"
              ? "ARC_MAINNET"
              : "ARC_TESTNET"),
          circleWalletSetId: circleWallet.walletSetId ?? undefined,
        },
      });

      // One WalletChain row per Unified Balance source chain so deposit
      // can resolve the correct Circle wallet id/address for sourceChain.
      await Promise.all(
        circleWallet.chainWallets.map((cw) =>
          tx.walletChain.create({
            data: {
              walletId: walletRow.id,
              chain: cw.chain,
              circleWalletId: cw.circleWalletId,
              address: cw.address,
            },
          })
        )
      );

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

    return {
      wallet: result.walletRow,
      ledgerAccounts: result.ledgerAccounts,
      alreadyProvisioned: false,
    };
  } catch (err) {
    console.error(
      `[provisioning] CRITICAL: Circle wallet(s) for org ${orgId} were created ` +
        `(primary ${circleWallet.circleWalletId} @ ${circleWallet.arcAddress}, ` +
        `${circleWallet.chainWallets.length} chain(s)) but the follow-up DB write failed. ` +
        `Manual reconciliation needed.`,
      err
    );
    throw err;
  }
}