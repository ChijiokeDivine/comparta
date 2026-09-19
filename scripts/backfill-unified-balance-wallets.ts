/**
 * scripts/backfill-unified-balance-wallets.ts
 *
 * For every existing Wallet (Arc-only), create SCAs on the remaining
 * Unified Balance source chains under the SAME wallet set + refId=orgId
 * so the address stays consistent, then write WalletChain rows.
 *
 * Safe to re-run: skips chains that already have a WalletChain row.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-unified-balance-wallets.ts
 *   npx tsx --env-file=.env scripts/backfill-unified-balance-wallets.ts --dry-run
 */

import { prisma } from "@/lib/db/prisma";
import {
  ensureUnifiedBalanceChainWallets,
  CircleApiError,
} from "@/lib/circle/wallets";
import { getUnifiedBalanceProvisionChains } from "@/lib/circle/circleBlockchains";
import type { Chain } from "@/app/generated/prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const needed = getUnifiedBalanceProvisionChains();
  console.log(
    `[backfill] Unified Balance chains to ensure: ${needed.join(", ")}`
  );
  if (DRY_RUN) console.log("[backfill] DRY RUN — no Circle or DB writes");

  const wallets = await prisma.wallet.findMany({
    include: { chainWallets: true, organization: { select: { id: true, legalName: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[backfill] Found ${wallets.length} org wallet(s)`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const w of wallets) {
    const existingChains = new Set<Chain>([
      w.chain, // primary Arc row
      ...w.chainWallets.map((c) => c.chain),
    ]);

    // Seed WalletChain for Arc if missing (so deposit path is uniform)
    const hasArcRow = w.chainWallets.some(
      (c) => c.chain === "ARC_TESTNET" || c.chain === "ARC_MAINNET"
    );

    const missing = needed.filter((c) => !existingChains.has(c));

    if (missing.length === 0 && hasArcRow) {
      console.log(
        `[backfill] SKIP org=${w.orgId} (${w.organization.legalName}) — already complete`
      );
      skipped++;
      continue;
    }

    console.log(
      `[backfill] org=${w.orgId} (${w.organization.legalName}) ` +
        `address=${w.arcAddress} missing=[${missing.join(", ")}] ` +
        `seedArc=${!hasArcRow}`
    );

    if (DRY_RUN) {
      ok++;
      continue;
    }

    try {
      // 1) Seed Arc WalletChain from existing Wallet row if needed
      if (!hasArcRow) {
        await prisma.walletChain.create({
          data: {
            walletId: w.id,
            chain: w.chain,
            circleWalletId: w.circleWalletId,
            address: w.arcAddress,
          },
        });
        console.log(`  → seeded WalletChain for ${w.chain}`);
      }

      // 2) Create missing chains at Circle + DB
      if (missing.length > 0) {
        const created = await ensureUnifiedBalanceChainWallets({
          orgId: w.orgId,
          walletId: w.id,
          existingCircleWalletSetId: w.circleWalletSetId,
          existingChains: [...existingChains],
        });

        for (const cw of created) {
          // Sanity: address should match Arc under same set+refId
          if (cw.address.toLowerCase() !== w.arcAddress.toLowerCase()) {
            console.warn(
              `  ⚠ address mismatch on ${cw.chain}: got ${cw.address}, expected ${w.arcAddress}`
            );
          }

          await prisma.walletChain.create({
            data: {
              walletId: w.id,
              chain: cw.chain,
              circleWalletId: cw.circleWalletId,
              address: cw.address,
            },
          });
          console.log(
            `  → created ${cw.chain} circleWalletId=${cw.circleWalletId}`
          );
        }
      }

      ok++;
    } catch (err) {
      failed++;
      console.error(
        `  ✗ FAILED org=${w.orgId}`,
        err instanceof CircleApiError ? err.message : err
      );
    }

    // Gentle pacing so Circle rate limits don't bite
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(
    `[backfill] done. ok=${ok} skipped=${skipped} failed=${failed} dryRun=${DRY_RUN}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());