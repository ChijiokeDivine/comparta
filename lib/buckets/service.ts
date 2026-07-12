// lib/buckets/service.ts
//
// Business logic for "buckets" — the product-facing name for LedgerAccount
// rows. This module owns CRUD and read-model shaping (balances,
// sparklines); it never mutates balances itself — every balance change
// still goes through lib/ledger/engine.ts's recordEntry() /
// transferBetweenLedgerAccounts(), same as before this phase.
//
// Design note for the UI layer: every exported function here returns
// plain, JSON-serializable-once-bigints-are-stringified data (see
// serialize.ts) shaped exactly as a dashboard/list/detail view would want
// it — callers shouldn't need to reshape anything, just serialize and
// return it from an API route.

import { prisma } from "@/lib/db/prisma";
import { getBalance } from "@/lib/ledger/engine";
import { toDecimalString } from "@/lib/circle/amount";
import { findBucketDependencies, type BucketDependency } from "./dependencies";
import type { LedgerAccount, LedgerAccountType } from "@/app/generated/prisma/client";

// Side-effect import: registers the built-in archive-blocking checks
// (default-bucket, active allocation rules, live payment links) against
// the shared registry in dependencies.ts. Must run before archiveBucket()
// is ever called — importing this module anywhere guarantees that.
import "./builtinDependencyCheckers";

export class BucketValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BucketValidationError";
  }
}

export class BucketNotFoundError extends Error {
  constructor() {
    super("Bucket not found");
    this.name = "BucketNotFoundError";
  }
}

export class BucketArchivedError extends Error {
  constructor() {
    super("This bucket is archived and can no longer be modified or used as a transfer endpoint.");
    this.name = "BucketArchivedError";
  }
}

export class BucketHasBalanceError extends Error {
  constructor(public readonly balance: bigint) {
    super(
      `This bucket still holds a balance of ${toDecimalString(balance)} USDC. Move funds out before archiving.`
    );
    this.name = "BucketHasBalanceError";
  }
}

export class BucketHasDependenciesError extends Error {
  constructor(public readonly dependencies: BucketDependency[]) {
    super(
      `This bucket can't be archived because it's still in use: ${dependencies
        .map((d) => d.label)
        .join(", ")}.`
    );
    this.name = "BucketHasDependenciesError";
  }
}

const RESERVED_TYPE_NAMES: Record<Exclude<LedgerAccountType, "CUSTOM">, string> = {
  OPERATING: "Operating",
  RESERVE: "Reserve",
  PAYROLL: "Payroll",
  SAVINGS: "Savings",
};

// ── ownership / lookup helpers ─────────────────────────────────────────

/** Ownership-scoped lookup — never trust a bare id from a client without this. */
export async function getBucket(orgId: string, ledgerAccountId: string): Promise<LedgerAccount> {
  const bucket = await prisma.ledgerAccount.findFirst({ where: { id: ledgerAccountId, orgId } });
  if (!bucket) throw new BucketNotFoundError();
  return bucket;
}

/** Throws BucketNotFoundError unless every id in `ledgerAccountIds` belongs to `orgId`. Use before any multi-bucket operation (transfers, rule creation). */
export async function assertBucketsBelongToOrg(orgId: string, ledgerAccountIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ledgerAccountIds));
  const found = await prisma.ledgerAccount.count({ where: { id: { in: uniqueIds }, orgId } });
  if (found !== uniqueIds.length) {
    throw new BucketNotFoundError();
  }
}

async function resolveOrgWalletId(orgId: string, explicitWalletId?: string): Promise<string> {
  if (explicitWalletId) {
    const wallet = await prisma.wallet.findFirst({ where: { id: explicitWalletId, orgId } });
    if (!wallet) throw new BucketValidationError("That wallet does not belong to this organization.");
    return wallet.id;
  }

  const wallets = await prisma.wallet.findMany({ where: { orgId }, select: { id: true } });
  if (wallets.length === 0) {
    throw new BucketValidationError("This organization has no wallet yet — a bucket needs one to attach to.");
  }
  if (wallets.length > 1) {
    throw new BucketValidationError(
      "This organization has more than one wallet — pass walletId explicitly to choose which one this bucket attaches to."
    );
  }
  return wallets[0].id;
}

// ── create / rename ────────────────────────────────────────────────────

export interface CreateBucketInput {
  orgId: string;
  name: string;
  type?: LedgerAccountType; // defaults to CUSTOM
  walletId?: string; // optional — auto-resolved if the org has exactly one wallet
}

export async function createBucket(input: CreateBucketInput): Promise<LedgerAccount> {
  const name = input.name.trim();
  if (!name) throw new BucketValidationError("Bucket name is required.");
  if (name.length > 100) throw new BucketValidationError("Bucket name must be 100 characters or fewer.");

  const walletId = await resolveOrgWalletId(input.orgId, input.walletId);

  try {
    return await prisma.ledgerAccount.create({
      data: {
        orgId: input.orgId,
        walletId,
        name,
        type: input.type ?? "CUSTOM",
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new BucketValidationError(`A bucket named "${name}" already exists for this organization.`);
    }
    throw err;
  }
}

export async function renameBucket(orgId: string, ledgerAccountId: string, newName: string): Promise<LedgerAccount> {
  const bucket = await getBucket(orgId, ledgerAccountId);
  if (bucket.archived) throw new BucketArchivedError();

  const name = newName.trim();
  if (!name) throw new BucketValidationError("Bucket name is required.");
  if (name.length > 100) throw new BucketValidationError("Bucket name must be 100 characters or fewer.");

  try {
    return await prisma.ledgerAccount.update({ where: { id: ledgerAccountId }, data: { name } });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new BucketValidationError(`A bucket named "${name}" already exists for this organization.`);
    }
    throw err;
  }
}

// ── archive / unarchive ────────────────────────────────────────────────

export async function archiveBucket(
  orgId: string,
  ledgerAccountId: string,
  archivedByUserId: string
): Promise<LedgerAccount> {
  const bucket = await getBucket(orgId, ledgerAccountId);
  if (bucket.archived) return bucket; // idempotent

  const balance = await getBalance(ledgerAccountId);
  if (balance !== 0n) {
    throw new BucketHasBalanceError(balance);
  }

  const dependencies = await findBucketDependencies(orgId, ledgerAccountId);
  if (dependencies.length > 0) {
    throw new BucketHasDependenciesError(dependencies);
  }

  return prisma.ledgerAccount.update({
    where: { id: ledgerAccountId },
    data: { archived: true, archivedAt: new Date(), archivedBy: archivedByUserId },
  });
}

/** Not in the original spec, but the natural inverse of archive — a bucket archived by mistake shouldn't require support intervention to restore. */
export async function unarchiveBucket(orgId: string, ledgerAccountId: string): Promise<LedgerAccount> {
  const bucket = await getBucket(orgId, ledgerAccountId);
  if (!bucket.archived) return bucket; // idempotent

  return prisma.ledgerAccount.update({
    where: { id: ledgerAccountId },
    data: { archived: false, archivedAt: null, archivedBy: null },
  });
}

// ── dashboard read model: list with balances + sparkline ──────────────

export interface SparklinePoint {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  /** Decimal string, e.g. "1234.56". */
  balance: string;
}

export interface BucketSummary {
  id: string;
  orgId: string;
  walletId: string;
  name: string;
  type: LedgerAccountType;
  archived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Decimal string. */
  balance: string;
  sparkline: SparklinePoint[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Daily balance series for the last `days` calendar days (UTC), inclusive
 * of today. Forward-fills days with no activity from the prior day's
 * balance, seeded from the balance immediately before the window so the
 * first point is never a false "started at zero."
 */
export async function getBucketSparkline(ledgerAccountId: string, days = 30): Promise<SparklinePoint[]> {
  const now = new Date();
  const rangeStart = startOfUtcDay(new Date(now.getTime() - (days - 1) * MS_PER_DAY));

  const priorEntry = await prisma.ledgerEntry.findFirst({
    where: { ledgerAccountId, createdAt: { lt: rangeStart } },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });

  const entriesInRange = await prisma.ledgerEntry.findMany({
    where: { ledgerAccountId, createdAt: { gte: rangeStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, balanceAfter: true },
  });

  const lastBalanceByDay = new Map<string, bigint>();
  for (const entry of entriesInRange) {
    lastBalanceByDay.set(toUtcDayKey(entry.createdAt), entry.balanceAfter);
  }

  const points: SparklinePoint[] = [];
  let runningBalance = priorEntry?.balanceAfter ?? 0n;

  for (let i = 0; i < days; i++) {
    const day = new Date(rangeStart.getTime() + i * MS_PER_DAY);
    const key = toUtcDayKey(day);
    const dayClose = lastBalanceByDay.get(key);
    if (dayClose !== undefined) runningBalance = dayClose;
    points.push({ date: key, balance: toDecimalString(runningBalance) });
  }

  return points;
}

export interface ListBucketsOptions {
  includeArchived?: boolean;
  /** Skip the (relatively expensive) sparkline queries for callers that only need balances, e.g. a transfer-source picker. */
  includeSparkline?: boolean;
  sparklineDays?: number;
}

/** The dashboard read model: every bucket for an org, side by side, with current balance and a 30-day trend. */
export async function listBucketsWithBalances(
  orgId: string,
  options: ListBucketsOptions = {}
): Promise<BucketSummary[]> {
  const { includeArchived = false, includeSparkline = true, sparklineDays = 30 } = options;

  const buckets = await prisma.ledgerAccount.findMany({
    where: includeArchived ? { orgId } : { orgId, archived: false },
    orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
  });

  return Promise.all(
    buckets.map(async (bucket) => {
      const [balance, sparkline] = await Promise.all([
        getBalance(bucket.id),
        includeSparkline ? getBucketSparkline(bucket.id, sparklineDays) : Promise.resolve([]),
      ]);

      return {
        id: bucket.id,
        orgId: bucket.orgId,
        walletId: bucket.walletId,
        name: bucket.name,
        type: bucket.type,
        archived: bucket.archived,
        archivedAt: bucket.archivedAt,
        createdAt: bucket.createdAt,
        updatedAt: bucket.updatedAt,
        balance: toDecimalString(balance),
        sparkline,
      };
    })
  );
}

export async function getBucketDetail(
  orgId: string,
  ledgerAccountId: string,
  sparklineDays = 30
): Promise<BucketSummary> {
  const bucket = await getBucket(orgId, ledgerAccountId);
  const [balance, sparkline] = await Promise.all([
    getBalance(bucket.id),
    getBucketSparkline(bucket.id, sparklineDays),
  ]);

  return {
    id: bucket.id,
    orgId: bucket.orgId,
    walletId: bucket.walletId,
    name: bucket.name,
    type: bucket.type,
    archived: bucket.archived,
    archivedAt: bucket.archivedAt,
    createdAt: bucket.createdAt,
    updatedAt: bucket.updatedAt,
    balance: toDecimalString(balance),
    sparkline,
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export { RESERVED_TYPE_NAMES };
