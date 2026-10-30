// scripts/cleanupStaleNetworkData.ts
//
// One-shot: removes financial data belonging to orgs whose wallet was
// provisioned on a DIFFERENT network than the one the app now runs on.
//
// WHY THIS EXISTS
// ---------------
// LedgerAccount/LedgerEntry have no network dimension (see prisma/schema.prisma)
// — only Wallet.chain does. So when a deployment flips testnet → mainnet, the
// old sandbox wallet (and every bucket balance built on it) stays visible
// forever: the ledger total keeps showing testnet numbers while the live
// onchain balance reads "—" because production Circle credentials cannot see
// a sandbox wallet id. This script deletes that stale set so the org can be
// re-provisioned cleanly on the active network.
//
// SCOPE (per org, in FK-safe order):
//   onchain_transactions, ledger_entries, ledger_accounts, wallets (+ their
//   wallet_chain_registrations), and every business row that RESTRICTs those
//   FKs: invoices, payment links, payroll schedule/runs/items, savings rules,
//   allocation rules, recurring transfers, yield positions/redemptions,
//   transaction categorizations, spending anomalies.
//
// It NEVER touches users, organizations, contacts, payees, API keys, or
// anything outside the financial tables above.
//
// Usage (repo root, .env loaded):
//
//   pnpm exec tsx scripts/cleanupStaleNetworkData.ts
//       → DRY RUN: prints exactly what would be deleted. No writes.
//
//   pnpm exec tsx scripts/cleanupStaleNetworkData.ts --confirm
//       → executes the deletion.
//
//   --chain=ARC_MAINNET   network to KEEP (default: ARC_MAINNET).
//                         Everything on any other chain is considered stale.
//   --org=<cuid>          limit to one organization.
//
// After the cleanup, re-provision the mainnet wallet (see
// app/api/org/kyb/approve/route.ts — now idempotent for already-APPROVED orgs):
//
//   curl -X POST https://www.comparta.xyz/api/org/kyb/approve \
//     -H "content-type: application/json" \
//     -H "x-admin-secret: $ADMIN_API_SECRET" \
//     -d '{"orgId":"<org id>","decision":"APPROVED"}'

import "dotenv/config";
// Must be imported BEFORE lib/db/prisma: that module captures DATABASE_URL at
// import time. Using DIRECT_URL (5432) instead of the transaction pooler
// (6543) avoids P1001 "can't reach database" under many sequential queries.
import "./_setDirectUrl";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/db/prisma";
import type { Chain } from "@/app/generated/prisma/client";

const CONFIRM = process.argv.includes("--confirm");

const chainArg = process.argv.find((a) => a.startsWith("--chain="));
const KEEP_CHAIN = (chainArg ? chainArg.slice("--chain=".length) : "ARC_MAINNET") as Chain;

if (KEEP_CHAIN !== "ARC_TESTNET" && KEEP_CHAIN !== "ARC_MAINNET") {
  throw new Error(`--chain must be ARC_TESTNET or ARC_MAINNET (got ${KEEP_CHAIN})`);
}

const orgArg = process.argv.find((a) => a.startsWith("--org="));
const ONLY_ORG = orgArg ? orgArg.slice("--org=".length) : null;

interface Scope {
  orgId: string;
  orgName: string;
  walletIds: string[];
  accountIds: string[];
  wallets: { id: string; chain: Chain; arcAddress: string }[];
}

async function buildScopes(): Promise<Scope[]> {
  const wallets = await withRetry(() => prisma.wallet.findMany({
    where: {
      chain: { not: KEEP_CHAIN },
      ...(ONLY_ORG ? { orgId: ONLY_ORG } : {}),
    },
    select: {
      id: true,
      orgId: true,
      chain: true,
      arcAddress: true,
      organization: { select: { legalName: true } },
    },
    orderBy: { createdAt: "asc" },
  }));

  const byOrg = new Map<string, Scope>();
  for (const w of wallets) {
    const existing = byOrg.get(w.orgId);
    const entry = existing ?? {
      orgId: w.orgId,
      orgName: w.organization.legalName,
      walletIds: [],
      accountIds: [],
      wallets: [],
    };
    entry.walletIds.push(w.id);
    entry.wallets.push({ id: w.id, chain: w.chain, arcAddress: w.arcAddress });
    byOrg.set(w.orgId, entry);
  }

  for (const scope of byOrg.values()) {
    const accounts = await withRetry(() =>
      prisma.ledgerAccount.findMany({
        where: { orgId: scope.orgId },
        select: { id: true },
      })
    );
    scope.accountIds = accounts.map((a) => a.id);
  }

  return [...byOrg.values()];
}

async function collectCounts(scope: Scope): Promise<{ label: string; count: number }[]> {
  const { orgId, walletIds, accountIds } = scope;
  const w = { walletId: { in: walletIds } };
  const a = { ledgerAccountId: { in: accountIds } };

  // Sequential (not Promise.all): 20+ concurrent queries per org against the
  // Supabase pooler is what produced intermittent P1001 "can't reach database".
  const counters: [string, () => Promise<number>][] = [
    ["onchain_transactions", () => prisma.onchainTransaction.count({ where: w })],
    ["ledger_entries", () => prisma.ledgerEntry.count({ where: a })],
    ["ledger_accounts (buckets)", () => prisma.ledgerAccount.count({ where: { id: { in: accountIds } } })],
    ["wallet_chain_registrations", () => prisma.walletChainRegistration.count({ where: w })],
    ["invoices", () => prisma.invoice.count({ where: { orgId } })],
    ["invoice_events", () => prisma.invoiceEvent.count({ where: { invoice: { orgId } } })],
    ["payment_links", () => prisma.paymentLink.count({ where: { orgId } })],
    ["payment_link_payments", () => prisma.paymentLinkPayment.count({ where: { paymentLink: { orgId } } })],
    ["payroll_schedules", () => prisma.payrollSchedule.count({ where: { orgId } })],
    ["payroll_runs", () => prisma.payrollRun.count({ where: { orgId } })],
    ["payroll_run_items", () => prisma.payrollRunItem.count({ where: { payrollRun: { orgId } } })],
    ["savings_rules", () => prisma.savingsRule.count({ where: { orgId } })],
    ["savings_rule_executions", () => prisma.savingsRuleExecution.count({ where: { savingsRule: { orgId } } })],
    ["allocation_rules", () => prisma.allocationRule.count({ where: { orgId } })],
    ["allocation_rule_executions", () => prisma.allocationRuleExecution.count({ where: { allocationRule: { orgId } } })],
    ["recurring_transfers", () => prisma.recurringTransfer.count({ where: { orgId } })],
    ["recurring_transfer_executions", () => prisma.recurringTransferExecution.count({ where: { recurringTransfer: { orgId } } })],
    ["yield_positions", () => prisma.yieldPosition.count({ where: a })],
    ["yield_redemption_requests", () => prisma.yieldRedemptionRequest.count({ where: a })],
    ["transaction_categorizations", () => prisma.transactionCategorization.count({ where: { orgId } })],
    ["spending_anomalies", () => prisma.spendingAnomaly.count({ where: { orgId } })],
  ];

  const out: { label: string; count: number }[] = [];
  for (const [label, count] of counters) out.push({ label, count: await withRetry(count) });
  return out;
}

/** Retries transient pooler disconnects (P1001/P1017) with backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string }).code;
      const retryable = code === "P1001" || code === "P1017" || code === "P2028";
      if (i === attempts || !retryable) throw err;
      const waitMs = 1000 * i;
      console.warn(`  transient DB error (${code}), retry ${i}/${attempts - 1} in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

// JSON.stringify cannot serialize BigInt; USDC amounts are BigInt micro-units.
const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );

async function dumpScope(scope: Scope): Promise<string> {
  const { orgId, walletIds, accountIds } = scope;
  const walletFilter = { walletId: { in: walletIds } };
  const accountFilter = { ledgerAccountId: { in: accountIds } };

  const tables: [string, () => Promise<unknown[]>][] = [
    ["wallets", () => prisma.wallet.findMany({ where: { id: { in: walletIds } } })],
    ["wallet_chain_registrations", () => prisma.walletChainRegistration.findMany({ where: walletFilter })],
    ["ledger_accounts", () => prisma.ledgerAccount.findMany({ where: { id: { in: accountIds } } })],
    ["ledger_entries", () => prisma.ledgerEntry.findMany({ where: accountFilter })],
    ["onchain_transactions", () => prisma.onchainTransaction.findMany({ where: walletFilter })],
    ["invoices", () => prisma.invoice.findMany({ where: { orgId } })],
    ["invoice_events", () => prisma.invoiceEvent.findMany({ where: { invoice: { orgId } } })],
    ["payment_links", () => prisma.paymentLink.findMany({ where: { orgId } })],
    ["payment_link_payments", () => prisma.paymentLinkPayment.findMany({ where: { paymentLink: { orgId } } })],
    ["payroll_schedules", () => prisma.payrollSchedule.findMany({ where: { orgId } })],
    ["payroll_runs", () => prisma.payrollRun.findMany({ where: { orgId } })],
    ["payroll_run_items", () => prisma.payrollRunItem.findMany({ where: { payrollRun: { orgId } } })],
    ["savings_rules", () => prisma.savingsRule.findMany({ where: { orgId } })],
    ["savings_rule_executions", () => prisma.savingsRuleExecution.findMany({ where: { savingsRule: { orgId } } })],
    ["allocation_rules", () => prisma.allocationRule.findMany({ where: { orgId } })],
    ["allocation_rule_executions", () => prisma.allocationRuleExecution.findMany({ where: { allocationRule: { orgId } } })],
    ["recurring_transfers", () => prisma.recurringTransfer.findMany({ where: { orgId } })],
    ["recurring_transfer_executions", () => prisma.recurringTransferExecution.findMany({ where: { recurringTransfer: { orgId } } })],
    ["yield_positions", () => prisma.yieldPosition.findMany({ where: accountFilter })],
    ["yield_redemption_requests", () => prisma.yieldRedemptionRequest.findMany({ where: accountFilter })],
    ["transaction_categorizations", () => prisma.transactionCategorization.findMany({ where: { orgId } })],
    ["spending_anomalies", () => prisma.spendingAnomaly.findMany({ where: { orgId } })],
  ];

  const dir = join("backups", "cleanup-stale-network", scope.orgId);
  mkdirSync(dir, { recursive: true });

  // Sequential on purpose: 22 concurrent queries per org × 31 orgs would
  // hammer the Supabase pooler for no benefit.
  let rows = 0;
  for (const [name, query] of tables) {
    const data = await withRetry(query);
    rows += data.length;
    if (data.length > 0) writeFileSync(join(dir, `${name}.json`), json(data), "utf8");
  }
  writeFileSync(join(dir, "_meta.json"), json({ scope, rows, dumpedAt: new Date() }), "utf8");

  return `${rows} rows → ${dir}`;
}

async function wipeScope(scope: Scope): Promise<void> {
  const { orgId, walletIds, accountIds } = scope;

  await prisma.$transaction(async (tx) => {
    // 1. Rows that RESTRICT ledger_accounts / wallets but hang off them only
    //    indirectly — delete the executions/children first.
    const allocationRuleIds = (
      await tx.allocationRule.findMany({ where: { orgId }, select: { id: true } })
    ).map((r) => r.id);
    const savingsRuleIds = (
      await tx.savingsRule.findMany({ where: { orgId }, select: { id: true } })
    ).map((r) => r.id);
    const recurringIds = (
      await tx.recurringTransfer.findMany({ where: { orgId }, select: { id: true } })
    ).map((r) => r.id);
    const payrollRunIds = (
      await tx.payrollRun.findMany({ where: { orgId }, select: { id: true } })
    ).map((r) => r.id);
    const paymentLinkIds = (
      await tx.paymentLink.findMany({ where: { orgId }, select: { id: true } })
    ).map((r) => r.id);
    const invoiceIds = (
      await tx.invoice.findMany({ where: { orgId }, select: { id: true } })
    ).map((r) => r.id);

    const accountFilter = { ledgerAccountId: { in: accountIds } };

    await tx.yieldRedemptionRequest.deleteMany({ where: accountFilter });
    await tx.yieldPosition.deleteMany({ where: accountFilter });

    await tx.recurringTransferExecution.deleteMany({
      where: { recurringTransferId: { in: recurringIds } },
    });
    await tx.recurringTransfer.deleteMany({ where: { orgId } });

    await tx.savingsRuleExecution.deleteMany({
      where: { savingsRuleId: { in: savingsRuleIds } },
    });
    await tx.savingsRule.deleteMany({ where: { orgId } });

    await tx.allocationRuleExecution.deleteMany({
      where: { allocationRuleId: { in: allocationRuleIds } },
    });
    await tx.allocationRule.deleteMany({ where: { orgId } });

    await tx.payrollRunItem.deleteMany({ where: { payrollRunId: { in: payrollRunIds } } });
    await tx.payrollRun.deleteMany({ where: { orgId } });
    await tx.payrollSchedule.deleteMany({ where: { orgId } });

    await tx.paymentLinkPayment.deleteMany({
      where: { paymentLinkId: { in: paymentLinkIds } },
    });
    await tx.paymentLink.deleteMany({ where: { orgId } });

    await tx.invoiceEvent.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoice.deleteMany({ where: { orgId } });

    await tx.transactionCategorization.deleteMany({ where: { orgId } });
    await tx.spendingAnomaly.deleteMany({ where: { orgId } });

    // 2. Chain-anchored rows.
    await tx.onchainTransaction.deleteMany({ where: { walletId: { in: walletIds } } });
    await tx.ledgerEntry.deleteMany({ where: accountFilter });

    // Organization.defaultLedgerAccountId is the ONLY pointer that would
    // otherwise block deleting the buckets (SetNull semantics only apply on
    // delete, and we want this explicit anyway).
    await tx.organization.update({
      where: { id: orgId },
      data: { defaultLedgerAccountId: null },
    });

    await tx.ledgerAccount.deleteMany({ where: { walletId: { in: walletIds } } });
    await tx.wallet.deleteMany({ where: { id: { in: walletIds } } });
  }, {
    // ~40 sequential statements per org over the network; the default 5s
    // interactive-transaction budget is far too tight for that.
    maxWait: 30_000,
    timeout: 180_000,
  });
}

async function main(): Promise<void> {
  console.log(CONFIRM ? "MODE: APPLY (will DELETE rows)\n" : "MODE: DRY-RUN (no writes)\n");
  console.log(`Keeping wallets on chain: ${KEEP_CHAIN}`);
  if (ONLY_ORG) console.log(`Limited to org: ${ONLY_ORG}`);
  console.log("");

  const scopes = await buildScopes();
  if (scopes.length === 0) {
    console.log("No stale-network wallets found. Nothing to do.");
    return;
  }

  let totalRows = 0;
  for (const scope of scopes) {
    const counts = await collectCounts(scope);
    const rows = counts.reduce((sum, c) => sum + c.count, 0);
    totalRows += rows;

    console.log(`Org: ${scope.orgName} (${scope.orgId})`);
    for (const w of scope.wallets) {
      console.log(`  wallet ${w.id}  chain=${w.chain}  ${w.arcAddress}`);
    }
    for (const c of counts) {
      if (c.count > 0) console.log(`  ${c.label.padEnd(32)} ${c.count}`);
    }
    console.log(`  ${"TOTAL ROWS".padEnd(32)} ${rows}\n`);
  }

  console.log(`Orgs affected: ${scopes.length} | rows affected: ${totalRows}\n`);

  if (!CONFIRM) {
    console.log("Dry run only. Re-run with --confirm to delete.");
    return;
  }

  for (const scope of scopes) {
    process.stdout.write(`Backing up ${scope.orgName} ... `);
    console.log(await withRetry(() => dumpScope(scope)));
  }

  for (const scope of scopes) {
    process.stdout.write(`Deleting ${scope.orgName} (${scope.orgId}) ... `);
    await withRetry(() => wipeScope(scope));
    console.log("done");
  }

  console.log("\nCleanup complete. Re-provision the wallet on the active network next.");
}

main()
  .catch((err) => {
    console.error("\nCleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
