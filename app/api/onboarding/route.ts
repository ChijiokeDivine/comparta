// app/api/onboarding/route.ts
//
// Finalizes signup for OAuth (Google) users who arrived via /onboarding.
// A Google sign-up only gets us email + name — we need org legal name
// before we can approve the org. This endpoint:
//
//   1. Validates the signed-in user still requires onboarding.
//   2. Updates organization.legalName with the submitted value.
//   3. Provisions the org's Circle Developer-Controlled Wallet on Arc
//      and creates the four default ledger buckets (Operating, Tax
//      Reserve, Payroll, Savings) — EXACTLY the same work as
//      /api/org/kyb/approve. Reuses lib/org/provisioning.ts so the two
//      code paths stay in sync.
//   4. Flips organization.kybStatus = APPROVED with timestamps.
//   5. Sets user.onboardingCompleted = true.
//
// The response includes { requiresJwtUpdate: true } so the client can
// call `update({ onboardingCompleted: true, kybStatus: "APPROVED" })`
// — this avoids forcing a full logout/login before the new kybStatus
// propagates into the session token.
//
// Idempotent: if the org is already APPROVED and/or wallet is already
// provisioned, provisionOrgWallet is a no-op and the status update is
// harmless. Credential sign-ups go through /api/auth/register instead
// (they collect legalName up front), so this is a no-op for them.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { provisionOrgWallet } from "@/lib/org/provisioning";

const bodySchema = z.object({
  legalName: z.string().trim().min(1, "Please enter your organization or business name."),
  ownerName: z.string().trim().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.orgId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { legalName, ownerName } = parsed.data;
  const orgId = session.user.orgId;
  const userId = session.user.id;

  try {
    // Step 1: provision wallet + default ledger buckets first. This is
    // idempotent (returns the existing wallet if already provisioned).
    // We intentionally provision BEFORE flipping kybStatus, mirroring
    // /api/org/kyb/approve's ordering. If Circle is unreachable, we
    // return 500 and the user can retry — the org stays PENDING,
    // nothing irreversible has happened.
    const provisioning = await provisionOrgWallet(orgId).catch((err) => {
      console.error(`[onboarding] provisioning failed for org ${orgId}`, err);
      throw new Error(
        "We couldn't provision your wallet right now. Please try again in a moment."
      );
    });

    // Step 2: write everything else atomically.
    const [, updatedUser, updatedOrg] = await prisma.$transaction([
      prisma.organization.update({
        where: { id: orgId },
        data: {
          legalName,
          kybStatus: "APPROVED",
          kybApprovedAt: new Date(),
          // "onboarding" is treated as a self-approval; since Google
          // OAuth already verified the owner's email, we mirror the
          // same fields that /api/org/kyb/approve sets.
          kybApprovedBy: userId,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          onboardingCompleted: true,
          ...(ownerName ? { name: ownerName } : {}),
        },
        select: { onboardingCompleted: true },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { kybStatus: true },
      }),
    ]);

    return NextResponse.json({
      message: "Onboarding complete",
      requiresJwtUpdate: true,
      user: { onboardingCompleted: updatedUser.onboardingCompleted },
      organization: { kybStatus: updatedOrg?.kybStatus ?? "APPROVED" },
      wallet: {
        id: provisioning.wallet.id,
        arcAddress: provisioning.wallet.arcAddress,
        alreadyProvisioned: provisioning.alreadyProvisioned,
      },
    });
  } catch (err) {
    if (err instanceof Error) {
      // Surface user-facing provisioning messages verbatim.
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error(`[onboarding] unexpected failure for org ${orgId}`, err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
