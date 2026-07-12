// lib/auth/canManageBucket.ts
//
// Reusable authorization helper for anything that touches a LedgerAccount
// ("bucket"): manual transfers, allocation rules, and bucket CRUD today;
// Payroll (Phase 6) and Savings (Phase 7) are expected to call this same
// helper rather than re-deriving their own role check.
//
// Current rule (role-only): OWNER and ADMIN can manage (move money,
// create/edit/archive buckets, create/edit allocation rules). MEMBER can
// view balances/history but never mutate. Every authenticated org member
// can view — there is no separate "can view" gate function because
// viewing is the default; only mutation needs this check.
//
// The `ledgerAccountId` parameter is accepted (but unused) today so the
// signature doesn't need to change when finer-grained, per-bucket ACLs
// arrive later (e.g. "this MEMBER may manage Payroll but not Savings") —
// callers should always pass the bucket they're acting on even though it
// isn't consulted yet, so that future enforcement doesn't silently change
// behavior at call sites that forgot to pass it.

import type { AuthedContext } from "./kyb-gate";

export class BucketPermissionError extends Error {
  constructor(message = "Only an OWNER or ADMIN can manage buckets, transfers, and allocation rules.") {
    super(message);
    this.name = "BucketPermissionError";
  }
}

const MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);

/**
 * Returns whether `user` may mutate bucket state: manual transfers,
 * bucket create/rename/archive, allocation rule create/edit/delete.
 * Reserved `ledgerAccountId` param for future per-bucket ACLs — see file header.
 */
export function canManageBucket(user: Pick<AuthedContext, "role">, _ledgerAccountId?: string): boolean {
  return MANAGE_ROLES.has(user.role);
}

/** Throws BucketPermissionError if `user` may not manage buckets. Call at the top of any mutating route/service call. */
export function assertCanManageBucket(user: Pick<AuthedContext, "role">, ledgerAccountId?: string): void {
  if (!canManageBucket(user, ledgerAccountId)) {
    throw new BucketPermissionError();
  }
}
