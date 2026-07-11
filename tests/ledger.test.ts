// tests/ledger.test.ts
//
// Phase 0 acceptance test: verifies double-entry correctness of the ledger
// engine. Specifically:
//
//   1. For a single LedgerAccount, the sum of CREDIT entries minus the sum
//      of DEBIT entries always equals the current balanceAfter snapshot
//      (i.e. recordEntry() never drifts from full-history recomputation).
//   2. transferBetweenLedgerAccounts() is a true zero-sum move: an org's
//      TOTAL balance across all its LedgerAccounts is unchanged by an
//      internal transfer.
//   3. Concurrent writes to the same LedgerAccount never race — firing N
//      concurrent recordEntry() calls at one account results in exactly N
//      entries and a balance equal to the sum of their deltas (proves the
//      SELECT ... FOR UPDATE row lock is doing its job).
//
// Requires a real Postgres reachable via DATABASE_URL/DIRECT_URL (point
// this at a disposable test database, e.g. a local Docker Postgres or a
// Supabase branch — never run against production data). Run migrations
// first: `npx prisma migrate deploy` (or `db:migrate` in dev), then
// `npm run test`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  recordEntry,
  getBalance,
  transferBetweenLedgerAccounts,
  reconcileAccount,
  getOrgTotalLedgerBalance,
} from "@/lib/ledger/engine";

async function createTestOrgWithWallet() {
  const org = await prisma.organization.create({
    data: { legalName: `Test Org ${Date.now()}`, kybStatus: "APPROVED" },
  });
  const wallet = await prisma.wallet.create({
    data: {
      orgId: org.id,
      circleWalletId: `test-wallet-${org.id}`,
      arcAddress: `0xtest${org.id.slice(0, 10)}`,
      chain: "ARC_TESTNET",
    },
  });
  const operating = await prisma.ledgerAccount.create({
    data: { orgId: org.id, walletId: wallet.id, name: "Operating", type: "OPERATING" },
  });
  const savings = await prisma.ledgerAccount.create({
    data: { orgId: org.id, walletId: wallet.id, name: "Savings", type: "SAVINGS" },
  });
  return { org, wallet, operating, savings };
}

describe("ledger engine — double-entry correctness", () => {
  let ctx: Awaited<ReturnType<typeof createTestOrgWithWallet>>;

  beforeEach(async () => {
    ctx = await createTestOrgWithWallet();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("recordEntry produces a balance matching full-history recomputation", async () => {
    await recordEntry({
      ledgerAccountId: ctx.operating.id,
      amount: 100_000000n, // $100.00 in micro-USDC
      direction: "CREDIT",
      referenceType: "ONCHAIN_TX",
      referenceId: "tx-1",
    });
    await recordEntry({
      ledgerAccountId: ctx.operating.id,
      amount: 30_000000n,
      direction: "DEBIT",
      referenceType: "ONCHAIN_TX",
      referenceId: "tx-2",
    });

    const balance = await getBalance(ctx.operating.id);
    expect(balance).toBe(70_000000n);

    const reconciliation = await reconcileAccount(ctx.operating.id);
    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.computedBalance).toBe(70_000000n);
  });

  it("rejects a DEBIT that would take the balance negative", async () => {
    await recordEntry({
      ledgerAccountId: ctx.operating.id,
      amount: 10_000000n,
      direction: "CREDIT",
      referenceType: "ONCHAIN_TX",
      referenceId: "tx-1",
    });

    await expect(
      recordEntry({
        ledgerAccountId: ctx.operating.id,
        amount: 20_000000n,
        direction: "DEBIT",
        referenceType: "ONCHAIN_TX",
        referenceId: "tx-2",
      })
    ).rejects.toThrow(/Insufficient balance/);
  });

  it("transferBetweenLedgerAccounts is zero-sum across an org's total balance", async () => {
    await recordEntry({
      ledgerAccountId: ctx.operating.id,
      amount: 500_000000n,
      direction: "CREDIT",
      referenceType: "ONCHAIN_TX",
      referenceId: "tx-1",
    });

    const totalBefore = await getOrgTotalLedgerBalance(ctx.org.id);

    await transferBetweenLedgerAccounts(
      ctx.operating.id,
      ctx.savings.id,
      200_000000n,
      "INTERNAL_TRANSFER",
      "transfer-1"
    );

    const totalAfter = await getOrgTotalLedgerBalance(ctx.org.id);
    expect(totalAfter).toBe(totalBefore);

    expect(await getBalance(ctx.operating.id)).toBe(300_000000n);
    expect(await getBalance(ctx.savings.id)).toBe(200_000000n);
  });

  it("serializes concurrent writes to the same ledger account without losing updates", async () => {
    const concurrentCredits = 20;
    const amountEach = 1_000000n; // $1.00 each

    await Promise.all(
      Array.from({ length: concurrentCredits }, (_, i) =>
        recordEntry({
          ledgerAccountId: ctx.operating.id,
          amount: amountEach,
          direction: "CREDIT",
          referenceType: "ONCHAIN_TX",
          referenceId: `concurrent-${i}`,
        })
      )
    );

    const balance = await getBalance(ctx.operating.id);
    expect(balance).toBe(amountEach * BigInt(concurrentCredits));

    const entryCount = await prisma.ledgerEntry.count({
      where: { ledgerAccountId: ctx.operating.id },
    });
    expect(entryCount).toBe(concurrentCredits);

    const reconciliation = await reconcileAccount(ctx.operating.id);
    expect(reconciliation.matches).toBe(true);
  });
});

describe("ledger engine — org-level totals", () => {
  it("org total ledger balance equals sum across all its LedgerAccounts", async () => {
    const { org, operating, savings } = await createTestOrgWithWallet();

    await recordEntry({
      ledgerAccountId: operating.id,
      amount: 400_000000n,
      direction: "CREDIT",
      referenceType: "ONCHAIN_TX",
      referenceId: "tx-1",
    });
    await recordEntry({
      ledgerAccountId: savings.id,
      amount: 150_000000n,
      direction: "CREDIT",
      referenceType: "SAVINGS_SWEEP",
      referenceId: "sweep-1",
    });

    const [opBalance, savBalance, total] = await Promise.all([
      getBalance(operating.id),
      getBalance(savings.id),
      getOrgTotalLedgerBalance(org.id),
    ]);

    expect(total).toBe(opBalance + savBalance);
    expect(total).toBe(550_000000n);
  });
});
