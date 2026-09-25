// lib/transfers/migrateLedgerToOnchain.ts
//
// One-time bookkeeping fix for hybrid model C:
//   Some orgs already moved USDC into Unified Balance while the ledger was
//   left unchanged (old ledger-neutral deposit). Result: Σ ledger > Arc onchain.
//
// This does NOT move funds on-chain. It only debits selected buckets so that
//   Σ ledger ≈ Arc onchain
// Unified Balance is left as-is (it stays outside the ledger).

import { prisma } from "@/lib/db/prisma";
import { recordEntry, getBalance, InsufficientBalanceError } from "@/lib/ledger/engine";
import { getUsdcBalance } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";

export class MigrateLedgerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_ALLOCATION"
      | "INVALID_AMOUNT"
      | "NOTHING_TO_MIGRATE"
      | "INSUFFICIENT_LEDGER"
  ) {
    super(message);
    this.name = "MigrateLedgerError";
  }
}

export interface MigrateAllocation {
  ledgerAccountId: string;
  amount: string;
}

export interface MigratePreview {
  ledgerTotal: string;
  onchainArc: string;
  /** How much the ledger is ahead of onchain (must be debited to realign). */
  excess: string;
  buckets: { id: string; name: string; balance: string }[];
}

export async function previewLedgerOnchainGap(orgId: string): Promise<MigratePreview> {
  const wallet = await prisma.wallet.findFirst({ where: { orgId } });
  if (!wallet) {
    throw new MigrateLedgerError("No wallet provisioned.", "NO_WALLET");
  }

  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId, archived: false },
    select: { id: true, name: true },
  });

  const buckets: { id: string; name: string; balance: string }[] = [];
  let ledgerTotal = 0n;
  for (const a of accounts) {
    const bal = await getBalance(a.id);
    ledgerTotal += bal;
    buckets.push({ id: a.id, name: a.name, balance: toDecimalString(bal) });
  }

  let onchain = 0n;
  try {
    onchain = toSmallestUnit(await getUsdcBalance(wallet.circleWalletId));
  } catch (err) {
    console.warn("[migrateLedger] onchain read failed", err);
  }

  const excess = ledgerTotal > onchain ? ledgerTotal - onchain : 0n;

  return {
    ledgerTotal: toDecimalString(ledgerTotal),
    onchainArc: toDecimalString(onchain),
    excess: toDecimalString(excess),
    buckets,
  };
}

/**
 * Debit user-selected buckets by amounts that sum to exactly `excess`
 * (from preview). Idempotent per (org, bucket) via stable referenceId.
 */
export async function migrateLedgerToMatchOnchain(
  orgId: string,
  allocations: MigrateAllocation[],
  migrationKey: string
): Promise<{ debited: { ledgerAccountId: string; amount: string }[]; excess: string }> {
  const preview = await previewLedgerOnchainGap(orgId);
  const excess = toSmallestUnit(preview.excess);
  if (excess <= 0n) {
    throw new MigrateLedgerError("Ledger already at or below onchain — nothing to migrate.", "NOTHING_TO_MIGRATE");
  }

  if (!allocations.length) {
    throw new MigrateLedgerError("Select buckets to debit for the excess.", "INVALID_ALLOCATION");
  }

  let sum = 0n;
  const parsed: { ledgerAccountId: string; amount: bigint }[] = [];
  const seen = new Set<string>();
  for (const a of allocations) {
    if (seen.has(a.ledgerAccountId)) {
      throw new MigrateLedgerError("Duplicate bucket.", "INVALID_ALLOCATION");
    }
    seen.add(a.ledgerAccountId);
    let amt: bigint;
    try {
      amt = toSmallestUnit(a.amount);
    } catch {
      throw new MigrateLedgerError(`Invalid amount "${a.amount}".`, "INVALID_AMOUNT");
    }
    if (amt <= 0n) {
      throw new MigrateLedgerError("Each amount must be positive.", "INVALID_AMOUNT");
    }
    sum += amt;
    parsed.push({ ledgerAccountId: a.ledgerAccountId, amount: amt });
  }

  if (sum !== excess) {
    throw new MigrateLedgerError(
      `Allocations must sum to the excess (${preview.excess} USDC), got ${toDecimalString(sum)}.`,
      "INVALID_ALLOCATION"
    );
  }

  const debited: { ledgerAccountId: string; amount: string }[] = [];
  for (const a of parsed) {
    const account = await prisma.ledgerAccount.findFirst({
      where: { id: a.ledgerAccountId, orgId, archived: false },
    });
    if (!account) {
      throw new MigrateLedgerError(`Bucket ${a.ledgerAccountId} not found.`, "INVALID_ALLOCATION");
    }
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
        throw new MigrateLedgerError(
          `Bucket ${account.name} has insufficient balance for this migration debit.`,
          "INSUFFICIENT_LEDGER"
        );
      }
      throw err;
    }
    debited.push({ ledgerAccountId: a.ledgerAccountId, amount: toDecimalString(a.amount) });
  }

  return { debited, excess: preview.excess };
}
