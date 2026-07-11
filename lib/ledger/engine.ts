// lib/ledger/engine.ts
//
// This is the ONLY module in the codebase allowed to write to LedgerEntry.
// Every balance mutation — onchain settlement, invoice payment, payroll
// run, savings sweep, DCA, internal bucket transfer — must go through
// recordEntry() or transferBetweenLedgerAccounts(). Never write a
// LedgerEntry row anywhere else, and never UPDATE or DELETE one: this
// table is append-only. Corrections are new offsetting entries with
// referenceType ADJUSTMENT.
//
// Concurrency: recordEntry() takes a row lock (SELECT ... FOR UPDATE) on
// the target LedgerAccount for the duration of the transaction, so two
// concurrent writes to the same account can never race on balanceAfter.

import { Prisma, LedgerDirection, LedgerReferenceType } from "../../app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export class InsufficientBalanceError extends LedgerError {
  constructor(ledgerAccountId: string, requested: bigint, available: bigint) {
    super(
      `Insufficient balance in ledger account ${ledgerAccountId}: requested ${requested}, available ${available}`
    );
    this.name = "InsufficientBalanceError";
  }
}

type Tx = Prisma.TransactionClient;

/**
 * Locks a ledger account row and returns its current balance, computed from
 * the most recent entry's balanceAfter (or 0 if the account has never been
 * touched). Must be called inside an interactive transaction.
 */
async function lockAndGetBalance(tx: Tx, ledgerAccountId: string): Promise<bigint> {
  // Row lock via a raw query: Prisma has no first-class `FOR UPDATE`, and we
  // need the lock to be held on the LedgerAccount row (not LedgerEntry) so
  // two concurrent writers to the SAME account always serialize, even on
  // an account's very first entry when no LedgerEntry rows exist yet.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE id = ${ledgerAccountId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new LedgerError(`LedgerAccount ${ledgerAccountId} not found`);
  }

  const latest = await tx.ledgerEntry.findFirst({
    where: { ledgerAccountId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });

  return latest?.balanceAfter ?? 0n;
}

export interface RecordEntryInput {
  ledgerAccountId: string;
  amount: bigint; // always positive; direction determines credit/debit
  direction: LedgerDirection;
  referenceType: LedgerReferenceType;
  referenceId: string;
  /** Allow DEBIT to take the balance negative (rare — e.g. pre-authorized overdraft). Default false. */
  allowNegative?: boolean;
}

export interface LedgerEntryResult {
  id: string;
  ledgerAccountId: string;
  amount: bigint;
  direction: LedgerDirection;
  balanceAfter: bigint;
  createdAt: Date;
}

/**
 * The only sanctioned way to mutate a ledger account's balance. Wraps the
 * read-lock-write cycle in a single Postgres transaction.
 */
export async function recordEntry(
  input: RecordEntryInput,
  externalTx?: Tx
): Promise<LedgerEntryResult> {
  if (input.amount <= 0n) {
    throw new LedgerError("recordEntry: amount must be a positive bigint");
  }

  const run = async (tx: Tx): Promise<LedgerEntryResult> => {
    const currentBalance = await lockAndGetBalance(tx, input.ledgerAccountId);

    const delta = input.direction === "CREDIT" ? input.amount : -input.amount;
    const newBalance = currentBalance + delta;

    if (newBalance < 0n && !input.allowNegative) {
      throw new InsufficientBalanceError(input.ledgerAccountId, input.amount, currentBalance);
    }

    const entry = await tx.ledgerEntry.create({
      data: {
        ledgerAccountId: input.ledgerAccountId,
        amount: input.amount,
        direction: input.direction,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        balanceAfter: newBalance,
      },
    });

    return {
      id: entry.id,
      ledgerAccountId: entry.ledgerAccountId,
      amount: entry.amount,
      direction: entry.direction,
      balanceAfter: entry.balanceAfter,
      createdAt: entry.createdAt,
    };
  };

  return externalTx ? run(externalTx) : prisma.$transaction(run);
}

/**
 * Fast-path balance read: the denormalized snapshot on the latest entry.
 * For a fully reconciled, from-scratch computation see reconcileAccount().
 */
export async function getBalance(ledgerAccountId: string): Promise<bigint> {
  const latest = await prisma.ledgerEntry.findFirst({
    where: { ledgerAccountId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  return latest?.balanceAfter ?? 0n;
}

/**
 * Internal-only move between two of an org's buckets (e.g. Operating ->
 * Savings). Never touches the blockchain — just two offsetting entries in
 * the same Postgres transaction, so they can never be observed half-done.
 */
export async function transferBetweenLedgerAccounts(
  fromLedgerAccountId: string,
  toLedgerAccountId: string,
  amount: bigint,
  referenceType: LedgerReferenceType,
  referenceId: string
): Promise<{ debit: LedgerEntryResult; credit: LedgerEntryResult }> {
  if (fromLedgerAccountId === toLedgerAccountId) {
    throw new LedgerError("transferBetweenLedgerAccounts: source and destination must differ");
  }
  if (amount <= 0n) {
    throw new LedgerError("transferBetweenLedgerAccounts: amount must be a positive bigint");
  }

  return prisma.$transaction(async (tx: Tx) => {
    // Lock accounts in a stable order (by id) to avoid deadlocks when two
    // transfers move money between the same pair of accounts in opposite
    // directions concurrently.
    const [firstId, secondId] = [fromLedgerAccountId, toLedgerAccountId].sort();
    await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${firstId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${secondId} FOR UPDATE`;

    const debit = await recordEntry(
      {
        ledgerAccountId: fromLedgerAccountId,
        amount,
        direction: "DEBIT",
        referenceType,
        referenceId,
      },
      tx
    );
    const credit = await recordEntry(
      {
        ledgerAccountId: toLedgerAccountId,
        amount,
        direction: "CREDIT",
        referenceType,
        referenceId,
      },
      tx
    );

    return { debit, credit };
  });
}

export interface ReconciliationResult {
  ledgerAccountId: string;
  snapshotBalance: bigint;
  computedBalance: bigint;
  matches: boolean;
}

/**
 * Recomputes a ledger account's balance from the FULL entry history
 * (ignoring the denormalized balanceAfter snapshots entirely) and compares
 * it to the current snapshot. Run this periodically (see jobs/) — a
 * mismatch means either a bug or an entry written outside recordEntry(),
 * and should page someone immediately.
 */
export async function reconcileAccount(ledgerAccountId: string): Promise<ReconciliationResult> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { ledgerAccountId },
    orderBy: { createdAt: "asc" },
    select: { amount: true, direction: true },
  });

  const computedBalance = entries.reduce(
    (sum: bigint, e: { amount: bigint; direction: LedgerDirection }) =>
      sum + (e.direction === "CREDIT" ? e.amount : -e.amount),
    0n
  );

  const snapshotBalance = await getBalance(ledgerAccountId);

  return {
    ledgerAccountId,
    snapshotBalance,
    computedBalance,
    matches: computedBalance === snapshotBalance,
  };
}

/** Reconciles every ledger account belonging to an org in one pass. */
export async function reconcileOrg(orgId: string): Promise<ReconciliationResult[]> {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId },
    select: { id: true },
  });
  return Promise.all(accounts.map((a: { id: string }) => reconcileAccount(a.id)));
}

/**
 * Sum of every LedgerAccount's current balance for an org — used by the
 * Phase 0 acceptance test to assert this equals the actual onchain wallet
 * balance (within tolerance / after confirmation lag).
 */
export async function getOrgTotalLedgerBalance(orgId: string): Promise<bigint> {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId },
    select: { id: true },
  });
  const balances = await Promise.all(accounts.map((a: { id: string }) => getBalance(a.id)));
  return balances.reduce((sum, b) => sum + b, 0n);
}
