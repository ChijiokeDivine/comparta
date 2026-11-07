// lib/auth/kyb-gate.ts
//
// Server-side auth guard used by API routes. Historically this module also
// blocked financial operations unless Organization.kybStatus === 'APPROVED'.
//
// KYB is currently NOT enforced anywhere: every authenticated member can
// use every feature regardless of verification status. The
// `requireApprovedOrg` name is kept so existing routes don't need to change;
// it now behaves exactly like requireAuth. When real KYB-gated features are
// introduced later, this is the single place to re-enable the check.

import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export class KybNotApprovedError extends Error {
  constructor(public readonly status: string) {
    super(`Organization KYB status is ${status}, expected APPROVED`);
    this.name = "KybNotApprovedError";
  }
}

export interface AuthedContext {
  userId: string;
  orgId: string;
  role: string;
}

/** Throws UnauthenticatedError if there's no session. Use for any authed route. */
export async function requireAuth(): Promise<AuthedContext> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.orgId) {
    throw new UnauthenticatedError();
  }

  return { userId: session.user.id, orgId: session.user.orgId, role: session.user.role };
}

/**
 * Temporarily identical to requireAuth: KYB verification is not required
 * for any feature right now. Kept as a separate function so the historical
 * call sites remain meaningful and so the gate can be reinstated in one
 * place.
 */
export async function requireApprovedOrg(): Promise<AuthedContext> {
  return requireAuth();
}
