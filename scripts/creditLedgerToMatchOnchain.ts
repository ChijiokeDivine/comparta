// scripts/creditLedgerToMatchOnchain.ts
//
// One-shot: for EVERY org with Arc onchain > Σ ledger, CREDIT buckets so
// Σ ledger ≈ onchain (hybrid model C). Does NOT move funds on-chain.
//
// Allocation: put the entire shortfall on the first non-archived bucket
// (by name asc) — usually Operating if named that way; otherwise the
// first bucket. Override with --org for a single org after checking GET.
//
// Usage (repo root, .env loaded):
//
//   pnpm exec tsx scripts/creditLedgerToMatchOnchain.ts
//   pnpm exec tsx scripts/creditLedgerToMatchOnchain.ts --apply
//   pnpm exec tsx scripts/creditLedgerToMatchOnchain.ts --apply --org=cmxxxxxx
//
// Prefer DIRECT_URL for local scripts if the pooler is unreachable.

import "dotenv/config";

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

import { prisma } from "@/lib/db/prisma";
import { getBalance, recordEntry } from "@/lib/ledger/engine";
import { getUsdcBalance } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";

const APPLY = process.argv.includes("--apply");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const ONLY_ORG = orgArg ? orgArg.slice("--org=".length) : null;
const MIN_SHORTFALL = 1n;

async function main() {
  console.log(APPLY ? "MODE: APPLY (will credit ledger)\n" : "MODE: DRY-RUN (no writes)\n");

  const orgs = await prisma.organization.findMany({
    where: ONLY_ORG ? { id: ONLY_ORG } : undefined,
    select: { id: true, legalName: true },
    orderBy: { createdAt: "asc" },
  });

  if (orgs.length === 0) {
    console.log("No organizations found.");
    return;
  }

  let would = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of orgs) {
    const label = `${org.legalName ?? "(unnamed)"} [${org.id}]`;
    try {
      const wallet = await prisma.wallet.findFirst({ where: { orgId: org.id } });
      if (!wallet) {
        console.log(`— ${label}: no wallet, skip`);
        skipped++;
        continue;
      }

      const accounts = await prisma.ledgerAccount.findMany({
        where: { orgId: org.id, archived: false },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      if (accounts.length === 0) {
        console.log(`— ${label}: no buckets, skip`);
        skipped++;
        continue;
      }

      let ledgerTotal = 0n;
      for (const a of accounts) {
        ledgerTotal += await getBalance(a.id);
      }

      let onchain = 0n;
      try {
        onchain = toSmallestUnit(await getUsdcBalance(wallet.circleWalletId));
      } catch (err) {
        console.warn(`— ${label}: onchain read failed, skip`, err instanceof Error ? err.message : err);
        failed++;
        continue;
      }

      const shortfall = onchain > ledgerTotal ? onchain - ledgerTotal : 0n;
      if (shortfall < MIN_SHORTFALL) {
        console.log(
          `— ${label}: OK (ledger ${toDecimalString(ledgerTotal)} ≥ onchain ${toDecimalString(onchain)} or equal)`
        );
        skipped++;
        continue;
      }

      // Prefer a bucket named Operating; else first by name
      const target =
        accounts.find((a) => a.name.toLowerCase().includes("operating")) ?? accounts[0];

      console.log(
        `${APPLY ? "→" : "·"} ${label}\n` +
          `    ledger=${toDecimalString(ledgerTotal)} onchain=${toDecimalString(onchain)} shortfall=${toDecimalString(shortfall)}\n` +
          `    credit ${target.name}: +${toDecimalString(shortfall)} USDC`
      );

      if (!APPLY) {
        would++;
        continue;
      }

      const reconcileKey = `batch-credit-${org.id}-${Date.now()}`;
      await recordEntry({
        ledgerAccountId: target.id,
        amount: shortfall,
        direction: "CREDIT",
        referenceType: "ADJUSTMENT",
        referenceId: `ub-credit-gap:${reconcileKey}:${target.id}`,
      });
      console.log(`    ✓ applied`);
      would++;
    } catch (err) {
      console.error(`✗ ${label}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(
    `\nDone. ${APPLY ? "Credited" : "Would credit"}: ${would}, skipped: ${skipped}, failed: ${failed}`
  );
  if (!APPLY && would > 0) {
    console.log("\nRe-run with --apply to write the ledger credits.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
