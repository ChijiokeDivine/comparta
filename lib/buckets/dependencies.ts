// lib/buckets/dependencies.ts
//
// Central registry for bucket-archival dependency checks. Any module that
// wants to block archiving a bucket under some condition registers a
// checker here - see builtinDependencyCheckers.ts for the checks this
// phase owns (default receiving bucket, active allocation rules, live
// payment links).
//
// Why the indirection: lib/buckets/service.ts imports this file (and, via
// its side-effect import of builtinDependencyCheckers.ts, causes the
// built-in checks to register themselves) but never imports the checkers
// directly. That means a future module - Payroll, DCA, whatever - can
// add its own dependency check by registering here without service.ts
// or this file ever needing to import that module back. Avoids a
// circular-import mess as the set of things that can "depend on" a
// bucket grows.

export interface BucketDependency {
  // Human-readable description of what's blocking archival, e.g.
  // "3 active allocation rule(s)" - surfaced directly in
  // BucketHasDependenciesError's message in service.ts.
  label: string;
  // How many of the dependency exist. Purely informational for now
  // (label already has it baked in for display) but kept separate so
  // callers can e.g. sum totals across checkers without parsing label.
  count: number;
}

export type BucketDependencyChecker = (
  orgId: string,
  ledgerAccountId: string
) => Promise<BucketDependency | null>;

// Module-level singleton array. Guarded against double-registration
// across dev-mode HMR reloads of this file by stashing the registry on
// globalThis - without this, editing builtinDependencyCheckers.ts (or
// any file importing it) during `next dev` would re-run every top-level
// registerBucketDependencyChecker() call and silently duplicate entries,
// so an archive attempt would run (and display) the same check 2x, 3x,
// etc. the more times you save a file.
const globalForBucketDeps = globalThis as unknown as {
  __bucketDependencyCheckers?: BucketDependencyChecker[];
};

const checkers: BucketDependencyChecker[] =
  globalForBucketDeps.__bucketDependencyCheckers ?? [];

if (process.env.NODE_ENV !== "production") {
  globalForBucketDeps.__bucketDependencyCheckers = checkers;
}

/**
 * Register a check that can block archiving a bucket. Call this at
 * module load time (top-level, as builtinDependencyCheckers.ts does) -
 * the checker fires on every archive attempt for every bucket, so keep
 * it cheap and scoped to `orgId`/`ledgerAccountId`.
 */
export function registerBucketDependencyChecker(checker: BucketDependencyChecker): void {
  checkers.push(checker);
}

/**
 * Runs every registered checker against one bucket and returns whichever
 * dependencies are actually blocking (i.e. filters out the `null`s).
 * An empty array means the bucket is safe to archive - see
 * archiveBucket() in service.ts, which throws BucketHasDependenciesError
 * when this returns anything non-empty.
 */
export async function findBucketDependencies(
  orgId: string,
  ledgerAccountId: string
): Promise<BucketDependency[]> {
  const results = await Promise.all(
    checkers.map((checker) => checker(orgId, ledgerAccountId))
  );
  return results.filter((r): r is BucketDependency => r !== null);
}