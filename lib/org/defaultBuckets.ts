// lib/org/defaultBuckets.ts
//
// Default "buckets" (LedgerAccount rows) created when an account is
// opened. Buckets are a purely local ledger concept and do NOT require a
// wallet, so they're created at signup before any Circle wallet exists.
// When a wallet is later created (see lib/org/provisioning.ts), these
// buckets are attached to it.
//
// The set of defaults depends on what kind of account signed up:
//   - Businesses/organizations get Operating / Reserve / Payroll / Savings.
//   - Individuals get buckets that make sense for personal finances:
//     Spending / Bills / Savings / Emergency.
//
// Keeping this in one place means signup (credentials), onboarding
// (Google), and wallet provisioning all create the exact same layout.

import { prisma } from "@/lib/db/prisma";
import type {
  AccountType,
  LedgerAccountType,
  Prisma,
} from "@/app/generated/prisma/client";

export interface DefaultBucketDefinition {
  name: string;
  type: LedgerAccountType;
}

export const BUSINESS_DEFAULT_BUCKETS: DefaultBucketDefinition[] = [
  { name: "Operating", type: "OPERATING" },
  { name: "Reserve", type: "RESERVE" },
  { name: "Payroll", type: "PAYROLL" },
  { name: "Savings", type: "SAVINGS" },
];

export const PERSONAL_DEFAULT_BUCKETS: DefaultBucketDefinition[] = [
  { name: "Spending", type: "OPERATING" },
  { name: "Bills", type: "RESERVE" },
  { name: "Savings", type: "SAVINGS" },
  { name: "Emergency", type: "CUSTOM" },
];

export function defaultBucketsForAccountType(
  accountType?: AccountType | null
): DefaultBucketDefinition[] {
  return accountType === "BUSINESS" || accountType === "ORGANIZATION"
    ? BUSINESS_DEFAULT_BUCKETS
    : PERSONAL_DEFAULT_BUCKETS;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Creates any missing default buckets for an org and points the org's
 * default receiving bucket at the first one if it isn't configured yet.
 *
 * Idempotent: existing bucket names are left untouched, so this is safe to
 * call from signup, onboarding, and again when a wallet is provisioned.
 */
export async function ensureDefaultBucketsForOrg(
  orgId: string,
  options: {
    accountType?: AccountType | null;
    walletId?: string | null;
    db?: Db;
  } = {}
) {
  const db = options.db ?? prisma;

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { accountType: true, defaultLedgerAccountId: true },
  });
  if (!org) return [];

  const definitions = defaultBucketsForAccountType(
    options.accountType ?? org.accountType
  );

  const existing = await db.ledgerAccount.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const existingNames = new Set(existing.map((b) => b.name));

  for (const bucket of definitions) {
    if (existingNames.has(bucket.name)) continue;
    await db.ledgerAccount.create({
      data: {
        orgId,
        walletId: options.walletId ?? null,
        name: bucket.name,
        type: bucket.type,
        // Yield/USYC is not enabled by default (feature currently off).
        isYieldEnabled: false,
        yieldAllocationPct: null,
      },
    });
    existingNames.add(bucket.name);
  }

  // Make sure unmatched inbound payments have a bucket to land in, even
  // for individual accounts that have no "Operating" bucket.
  if (!org.defaultLedgerAccountId) {
    const first = await db.ledgerAccount.findFirst({
      where: { orgId, archived: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (first) {
      await db.organization.update({
        where: { id: orgId },
        data: { defaultLedgerAccountId: first.id },
      });
    }
  }

  return db.ledgerAccount.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
  });
}
