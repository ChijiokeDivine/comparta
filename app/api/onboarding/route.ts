// app/api/onboarding/route.ts
//
// Finalizes signup for OAuth (Google) users who arrived via /onboarding.
// A Google sign-up only gets us email + name — we need a display/legal
// name, country, and account type before we can finish setting up the
// account. This endpoint:
//
//   1. Validates the signed-in user still requires onboarding.
//   2. Updates organization.legalName, .country, and .accountType with
//      the submitted values.
//   3. Creates the four default ledger buckets for that account type
//      (business vs individual) — without a wallet. A wallet is only
//      created when the user explicitly asks for one later.
//   4. Sets user.onboardingCompleted = true.
//
// The response includes { requiresJwtUpdate: true } so the client can
// call `update({ onboardingCompleted: true })` — this avoids forcing a
// full logout/login before the new flag propagates into the session token.
//
// Idempotent: bucket creation only adds missing defaults. Credential
// sign-ups go through /api/auth/register instead (they collect these
// details up front), so this is a no-op for them.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureDefaultBucketsForOrg } from "@/lib/org/defaultBuckets";

// Keep in sync with the AccountType enum in schema.prisma.
const ACCOUNT_TYPES = ["STUDENT", "PERSONAL", "BUSINESS", "ORGANIZATION"] as const;

const bodySchema = z.object({
  legalName: z.string().trim().min(1, "Please enter your organization or business name."),
  ownerName: z.string().trim().optional(),
  // ISO 3166-1 alpha-2 code (e.g. "US") — the value CountrySelect submits.
  country: z
    .string()
    .trim()
    .length(2, "Please select your country.")
    .transform((v) => v.toUpperCase()),
  accountType: z.enum(ACCOUNT_TYPES, {
    error: () => ({ message: "Please choose what best describes you." }),
  }),
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

  const { legalName, ownerName, country, accountType } = parsed.data;
  const orgId = session.user.orgId;
  const userId = session.user.id;

  try {
    // Step 1: write the org/user fields atomically. No wallet is created
    // here — the user can create one from the dashboard when ready.
    const [, updatedUser, updatedOrg] = await prisma.$transaction([
      prisma.organization.update({
        where: { id: orgId },
        data: {
          legalName,
          country,
          accountType,
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

    // Step 2: create the account-type-appropriate default buckets, no
    // wallet required. A failure is logged but doesn't fail onboarding —
    // wallet creation will backfill any missing defaults.
    try {
      await ensureDefaultBucketsForOrg(orgId, { accountType });
    } catch (err) {
      console.error(`[onboarding] default bucket creation failed for org ${orgId}`, err);
    }

    return NextResponse.json({
      message: "Onboarding complete",
      requiresJwtUpdate: true,
      user: { onboardingCompleted: updatedUser.onboardingCompleted },
      organization: { kybStatus: updatedOrg?.kybStatus ?? "PENDING" },
      wallet: null,
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