// app/api/auth/register/route.ts
//
// Signs up a new business: creates the Organization and its first User
// (role: OWNER).
//
// Every registration is auto-approved: kybStatus is set to APPROVED at
// signup (no PENDING/manual-review path), and wallet + default-bucket
// provisioning is kicked off via next/server's after() right after the
// response is sent — so signup still responds fast even though
// provisioning calls out to Circle, but (unlike a bare fire-and-forget
// promise) the platform keeps the function alive until it finishes,
// instead of risking it getting frozen/killed the instant the response
// flushes on serverless. This still means there's a brief window
// (typically well under a second) right after signup where kybStatus
// reads APPROVED but the wallet/buckets don't exist yet; every page that
// reads them (app/(app)/wallet, app/(app)/dashboard, etc.) already
// renders an empty state rather than erroring when a wallet is missing,
// so that's safe to leave unsynchronized rather than blocking the
// response on a Circle round-trip.
//
// NOTE: this intentionally bypasses the old DEMO_KYB_APPROVED-only gate
// in lib/config/demoMode.ts — every account is now approved regardless
// of that flag. If you need the real pending-review flow back (e.g. for
// production), reintroduce the conditional around kybStatus below.

import { NextResponse, after } from "next/server";
// NOTE: after() requires Next.js 15+ (stable) / 14.1+ (as unstable_after).
// If your Next version predates that, this import will fail — swap back
// to a plain un-awaited provisionOrgWallet(...).catch(...) call, or
// upgrade Next, whichever's faster for the hackathon.
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { provisionOrgWallet } from "@/lib/org/provisioning";
import { issueOtp } from "@/lib/otp/service";
import { sendEmailVerificationOtpEmail } from "@/lib/notifications/notify";

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
      kybStatus: "APPROVED",
      kybApprovedAt: new Date(),
      kybApprovedBy: "auto-approved-on-signup",
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

  // Issue + email a verification OTP.
  //   - Best-effort: even if email delivery fails (e.g. no Resend key in dev),
  //     the account still exists and the user can re-trigger a send from
  //     /api/auth/verification/send or the /verify-otp UI.
  //   - Done in the same request (not after()) because the response tells the
  //     client where to redirect (/verify-otp) and we want the OTP row to
  //     exist before that page tries to resend.
  let otpSent = false;
  try {
    const issued = await issueOtp(normalizedEmail, "EMAIL_VERIFICATION");
    if (issued.ok && issued.code) {
      await sendEmailVerificationOtpEmail({
        recipientEmail: normalizedEmail,
        code: issued.code,
      });
      otpSent = true;
    } else {
      console.warn(
        `[register] could not issue email-verification OTP for ${normalizedEmail}: ${issued.error}`
      );
    }
  } catch (err) {
    console.error(`[register] OTP send failed for ${normalizedEmail}`, err);
  }

  // after() schedules this to run once the response has been sent, but
  // — unlike a bare un-awaited promise — the platform (Vercel, etc.)
  // keeps the serverless function alive until it settles, so it can't
  // get silently cut off. provisionOrgWallet is idempotent, so even if
  // this races with a later manual /api/org/kyb/approve call for the
  // same org, only one wallet is ever created.
  after(async () => {
    try {
      await provisionOrgWallet(org.id);
    } catch (err) {
      console.error(`[register] background provisioning failed for org ${org.id}`, err);
    }
  });

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
      // Signpost for the client to redirect to /verify-otp (not sign in).
      nextStep: "verify-email",
      otpSent,
      message:
        "Account created. Check your email for a 6-digit verification code to confirm your email.",
    },
    { status: 201 }
  );
}