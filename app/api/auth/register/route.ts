// app/api/auth/register/route.ts
//
// Signs up a new business: creates the Organization and its first User
// (role: OWNER).
//
// Normal flow: kybStatus starts PENDING and no wallet is provisioned —
// that happens once KYB is approved (see /api/org/kyb/approve), per the
// middleware.ts / kyb-gate.ts rule that no financial feature is reachable
// pre-approval.
//
// DEMO_KYB_APPROVED flow (see lib/config/demoMode.ts): the org is created
// already APPROVED, and wallet + default-bucket provisioning is kicked
// off via next/server's after() right after the response is sent — so
// signup still responds fast even though provisioning calls out to
// Circle, but (unlike a bare fire-and-forget promise) the platform keeps
// the function alive until it finishes, instead of risking it getting
// frozen/killed the instant the response flushes on serverless. This
// still means there's a brief window (typically well under a second)
// right after signup where kybStatus reads APPROVED but the
// wallet/buckets don't exist yet; every page that reads them
// (app/(app)/wallet, app/(app)/dashboard, etc.) already renders an empty
// state rather than erroring when a wallet is missing, so that's safe to
// leave unsynchronized rather than blocking the response on a Circle
// round-trip.

import { NextResponse, after } from "next/server";
// NOTE: after() requires Next.js 15+ (stable) / 14.1+ (as unstable_after).
// If your Next version predates that, this import will fail — swap back
// to a plain un-awaited provisionOrgWallet(...).catch(...) call, or
// upgrade Next, whichever's faster for the hackathon.
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { DEMO_KYB_APPROVED } from "@/lib/config/demoMode";
import { provisionOrgWallet } from "@/lib/org/provisioning";

const registerSchema = z.object({
  legalName: z.string().min(2, "Legal business name is required"),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  ownerName: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { legalName, email, password, ownerName } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const org = await prisma.organization.create({
    data: {
      legalName,
      ...(DEMO_KYB_APPROVED
        ? { kybStatus: "APPROVED", kybApprovedAt: new Date(), kybApprovedBy: "demo-mode" }
        : { kybStatus: "PENDING" }),
      users: {
        create: {
          email: normalizedEmail,
          passwordHash,
          name: ownerName,
          role: "OWNER",
        },
      },
    },
    include: { users: true },
  });

  if (DEMO_KYB_APPROVED) {
    // after() schedules this to run once the response has been sent, but
    // — unlike a bare un-awaited promise — the platform (Vercel, etc.)
    // keeps the serverless function alive until it settles, so it can't
    // get silently cut off. provisionOrgWallet is idempotent, so even if
    // this races with a later manual /api/org/kyb/approve call for the
    // same org (e.g. demo mode gets flipped off mid-hackathon), only one
    // wallet is ever created.
    after(async () => {
      try {
        await provisionOrgWallet(org.id);
      } catch (err) {
        console.error(`[register] background provisioning failed for org ${org.id}`, err);
      }
    });
  }

  return NextResponse.json(
    {
      organization: {
        id: org.id,
        legalName: org.legalName,
        kybStatus: org.kybStatus,
      },
      user: {
        id: org.users[0].id,
        email: org.users[0].email,
        role: org.users[0].role,
      },
      message: DEMO_KYB_APPROVED
        ? "Account created. Your organization is approved and your wallet is being set up now."
        : "Account created. Your organization's KYB review is pending — financial features unlock once it's approved.",
    },
    { status: 201 }
  );
}