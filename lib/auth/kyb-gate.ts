// lib/auth/kyb-gate.ts
//
// Server-side guard used by every API route that touches money (wallet
// creation, sending funds, payroll, savings sweeps, DCA). Blocks access
// unless Organization.kybStatus === 'APPROVED'.
//
// Deliberately re-reads kybStatus from Postgres rather than trusting the
// JWT session claim: an admin can flip an org from PENDING to APPROVED (or
// vice versa, e.g. on a compliance hold) after a user's session was
// issued, and financial gating can't lag behind that by a session's
// lifetime.

import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "@/lib/db/prisma";

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

/** Throws UnauthenticatedError if there's no session. Use for any authed (non-financial) route. */
export async function requireAuth(): Promise<AuthedContext> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.orgId) {
    throw new UnauthenticatedError();
  }

  return { userId: session.user.id, orgId: session.user.orgId, role: session.user.role };
}

/**
 * Throws UnauthenticatedError or KybNotApprovedError if the gate fails.
 * Call this at the top of every financial API route handler:
 *
 *   const ctx = await requireApprovedOrg();
 *   // ... proceed, ctx.orgId is guaranteed KYB-approved
 */
export async function requireApprovedOrg(): Promise<AuthedContext> {
  const ctx = await requireAuth();

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { kybStatus: true },
  });

  if (!org) {
    throw new UnauthenticatedError();
  }
  if (org.kybStatus !== "APPROVED") {
    throw new KybNotApprovedError(org.kybStatus);
  }

  return ctx;
}
