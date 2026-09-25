// scripts/migrateAllLedgerToOnchain.ts
//
// One-shot: for EVERY org with Σ ledger > Arc onchain, debit buckets so
// Σ ledger ≈ onchain (hybrid model C migration). Does NOT move funds on-chain.
//
// Allocation strategy (no interactive choice): waterfall from largest
// bucket balance to smallest until `excess` is fully allocated.
//
// Usage (from repo root, with .env loaded the same way as the app):
//
//   # Preview only (default) — prints what would be debited, writes nothing
//   pnpm exec tsx scripts/migrateAllLedgerToOnchain.ts
//
//   # Actually apply
//   pnpm exec tsx scripts/migrateAllLedgerToOnchain.ts --apply
//
//   # Single org
//   pnpm exec tsx scripts/migrateAllLedgerToOnchain.ts --apply --org=cmxxxxxx
//
// Requires DATABASE_URL + Circle env (for getUsdcBalance) in the environment.
import "dotenv/config";
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}
import { prisma } from "@/lib/db/prisma";
import { getBalance, recordEntry, InsufficientBalanceError } from "@/lib/ledger/engine";
import { getUsdcBalance } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";

const APPLY = process.argv.includes("--apply");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const ONLY_ORG = orgArg ? orgArg.slice("--org=".length) : null;

/** Dust under 0.000001 USDC — skip. */
const MIN_EXCESS = 1n; // 1 micro-USDC

async function main() {
  console.log(APPLY ? "MODE: APPLY (will write ledger debits)\n" : "MODE: DRY-RUN (no writes)\n");

  const orgs = await prisma.organization.findMany({
    where: ONLY_ORG ? { id: ONLY_ORG } : undefined,
    select: { id: true, legalName: true },
    orderBy: { createdAt: "asc" },
  });

  if (orgs.length === 0) {
    console.log("No organizations found.");
    return;
  }

  let migrated = 0;
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
      });

      const buckets: { id: string; name: string; balance: bigint }[] = [];
      let ledgerTotal = 0n;
      for (const a of accounts) {
        const bal = await getBalance(a.id);
        ledgerTotal += bal;
        buckets.push({ id: a.id, name: a.name, balance: bal });
      }

      let onchain = 0n;
      try {
        onchain = toSmallestUnit(await getUsdcBalance(wallet.circleWalletId));
      } catch (err) {
        console.warn(`— ${label}: onchain read failed, skip`, err instanceof Error ? err.message : err);
        failed++;
        continue;
      }

      const excess = ledgerTotal > onchain ? ledgerTotal - onchain : 0n;
      if (excess < MIN_EXCESS) {
        console.log(
          `— ${label}: OK (ledger ${toDecimalString(ledgerTotal)} ≤ onchain ${toDecimalString(onchain)})`
        );
        skipped++;
        continue;
      }

      // Waterfall: largest balance first
      buckets.sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));

      const allocations: { ledgerAccountId: string; name: string; amount: bigint }[] = [];
      let remaining = excess;
      for (const b of buckets) {
        if (remaining <= 0n) break;
        if (b.balance <= 0n) continue;
        const take = b.balance < remaining ? b.balance : remaining;
        if (take <= 0n) continue;
        allocations.push({ ledgerAccountId: b.id, name: b.name, amount: take });
        remaining -= take;
      }

      if (remaining > 0n) {
        console.error(
          `✗ ${label}: could not allocate full excess (still short ${toDecimalString(remaining)}). Skip.`
        );
        failed++;
        continue;
      }

      console.log(
        `${APPLY ? "→" : "·"} ${label}\n` +
          `    ledger=${toDecimalString(ledgerTotal)} onchain=${toDecimalString(onchain)} excess=${toDecimalString(excess)}`
      );
      for (const a of allocations) {
        console.log(`    - ${a.name}: −${toDecimalString(a.amount)} USDC`);
      }

      if (!APPLY) {
        migrated++; // count as “would migrate”
        continue;
      }

      const migrationKey = `batch-${org.id}-${Date.now()}`;
      for (const a of allocations) {
        try {
          await recordEntry({
            ledgerAccountId: a.ledgerAccountId,
            amount: a.amount,
            direction: "DEBIT",
            referenceType: "ADJUSTMENT",
            referenceId: `ub-migrate:${migrationKey}:${a.ledgerAccountId}`,
          });
        } catch (err) {
          if (err instanceof InsufficientBalanceError) {
            console.error(`✗ ${label}: insufficient on ${a.name} mid-apply — stop this org`);
            failed++;
            break;
          }
          throw err;
        }
      }
      console.log(`    ✓ applied`);
      migrated++;
    } catch (err) {
      console.error(`✗ ${label}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(
    `\nDone. ${APPLY ? "Migrated" : "Would migrate"}: ${migrated}, skipped: ${skipped}, failed: ${failed}`
  );
  if (!APPLY && migrated > 0) {
    console.log("\nRe-run with --apply to write the ledger debits.");
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
