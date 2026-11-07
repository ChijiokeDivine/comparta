// lib/org/provisioning.ts
//
// Creates an org's single Circle Developer-Controlled Wallet on Arc and
// connects it to the org's existing default buckets.
//
// Buckets are now created independently at signup (see
// lib/org/defaultBuckets.ts) because a user does not need KYB or a wallet
// to start using the platform's local ledger. When a wallet is created:
//   - any wallet-less buckets are attached to the new wallet, and
//   - if the org somehow has none (e.g. an older Google sign-up), the
//     defaults are created at that point.
//
// Idempotent by design: if a wallet already exists for the org on the
// active network, this is a no-op that returns the existing wallet.

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { createWalletForOrg, ensureWalletDerivedOnDepositChains } from "@/lib/circle/wallets";
import { mapCircleBlockchain } from "@/lib/circle/chainMapping";
import { getNetworkProfile, resolveAppNetwork } from "@/lib/config/network";
import { ensureDefaultBucketsForOrg } from "@/lib/org/defaultBuckets";
import type { LedgerAccount, Wallet } from "@/app/generated/prisma/client";

export interface ProvisionOrgWalletResult {
  wallet: Wallet;
  ledgerAccounts: LedgerAccount[];
  alreadyProvisioned: boolean;
}

export async function provisionOrgWallet(orgId: string): Promise<ProvisionOrgWalletResult> {
  // Network-scoped, NOT just org-scoped. A wallet row provisioned on
  // testnet must never satisfy a mainnet provisioning request: Circle's
  // production credentials cannot see (or sign for) a sandbox wallet, so
  // treating the stale row as "already provisioned" leaves the org with a
  // wallet the live API rejects forever (balance reads come back "—" and
  // every send fails). After a network flip we deliberately create a NEW
  // wallet on the active chain and leave the old row to be cleaned up.
  const activeChain = getNetworkProfile(resolveAppNetwork()).chain;

  const existing = await prisma.wallet.findFirst({
    where: { orgId, chain: activeChain },
  });

  if (existing) {
    // Attach any buckets that were created before this wallet existed and
    // backfill defaults for orgs that predate signup-time bucket creation.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.ledgerAccount.updateMany({
        where: { orgId, walletId: null },
        data: { walletId: existing.id },
      });
      await ensureDefaultBucketsForOrg(orgId, { walletId: existing.id, db: tx });
    });

    const ledgerAccounts = await prisma.ledgerAccount.findMany({
      where: { orgId, walletId: existing.id },
    });
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
          chain:
            mapCircleBlockchain(circleWallet.chain) ??
            getNetworkProfile(resolveAppNetwork()).chain,
        },
      });

      // Buckets created at signup live without a wallet; attach them now.
      await tx.ledgerAccount.updateMany({
        where: { orgId, walletId: null },
        data: { walletId: walletRow.id },
      });

      // Creates any missing defaults (and sets the org's default receiving
      // bucket) for orgs that had no buckets at all.
      await ensureDefaultBucketsForOrg(orgId, {
        walletId: walletRow.id,
        db: tx,
      });

      const ledgerAccounts = await tx.ledgerAccount.findMany({
        where: { orgId, walletId: walletRow.id },
        orderBy: { createdAt: "asc" },
      });

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
