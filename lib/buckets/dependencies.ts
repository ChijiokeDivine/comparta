// lib/buckets/dependencies.ts
//
// Archiving a bucket must be blocked if anything still points at it —
// today that's active AllocationRules and non-expired PaymentLinks, but
// the acceptance criteria explicitly calls out that Payroll (Phase 6) and
// DCA/Savings (Phase 7/8) will ALSO need to block archival of a bucket
// they're scheduled against. Rather than having buckets/service.ts import
// those future modules directly (a dependency the wrong way round — this
// module should never need to know Payroll or DCA exist), each feature
// registers its own checker here at import time. buckets/service.ts only
// ever calls findBucketDependencies(); it never enumerates dependency
// types itself.
//
// Usage from a future feature module, e.g. lib/payroll/service.ts:
//
//   import { registerBucketDependencyChecker } from "@/lib/buckets/dependencies";
//
//   registerBucketDependencyChecker(async (orgId, ledgerAccountId) => {
//     const count = await prisma.payrollSchedule.count({
//       where: { orgId, fundingLedgerAccountId: ledgerAccountId, active: true },
//     });
//     return count > 0 ? { label: `${count} active payroll schedule(s)`, count } : null;
//   });
//
// That registration only needs to run once per process — the simplest
// place is a top-level side-effect import in the feature's own
// service.ts, same as lib/buckets/service.ts does for the built-in
// checkers below (see builtinDependencyCheckers.ts).

export interface BucketDependency {
  /** Human-readable, UI-ready description, e.g. "2 active allocation rules". */
  label: string;
  count: number;
}

export type BucketDependencyChecker = (
  orgId: string,
  ledgerAccountId: string
) => Promise<BucketDependency | null>;

const checkers: BucketDependencyChecker[] = [];

/** Register a checker. Safe to call multiple times across module reloads — duplicates just run twice, which is harmless (a checker returns null or the same count either way). */
export function registerBucketDependencyChecker(checker: BucketDependencyChecker): void {
  checkers.push(checker);
}

/** Runs every registered checker and returns only the ones that found something. Empty array = safe to archive. */
export async function findBucketDependencies(
  orgId: string,
  ledgerAccountId: string
): Promise<BucketDependency[]> {
  const results = await Promise.all(checkers.map((check) => check(orgId, ledgerAccountId)));
  return results.filter((r): r is BucketDependency => r !== null);
}

/** Test-only escape hatch — clears all registered checkers. Never call this from application code. */
export function __resetBucketDependencyCheckersForTests(): void {
  checkers.length = 0;
}
