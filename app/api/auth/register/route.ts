// app/api/auth/register/route.ts
//
// Signs up a new account: creates the Organization and its first User
// (role: OWNER). The signup form asks whether this is a business or an
// individual/personal account (submitted as accountType BUSINESS or
// PERSONAL) and the default bucket layout is chosen from that.
//
// KYB is NOT required at signup. The org starts PENDING (not verified),
// but that does not block any product feature today. The user can create
// a wallet later from the dashboard/wallet page.
//
// Default buckets are created immediately at signup. They do NOT require
// a wallet (LedgerAccount.walletId is nullable), so there is no Circle
// call and signup stays fast. A wallet is only created when the user
// explicitly asks for one via POST /api/wallet.

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { ensureDefaultBucketsForOrg } from "@/lib/org/defaultBuckets";
import { issueOtp } from "@/lib/otp/service";
import { sendEmailVerificationOtpEmail } from "@/lib/notifications/notify";

// Keep in sync with the AccountType enum in schema.prisma.
const ACCOUNT_TYPES = ["STUDENT", "PERSONAL", "BUSINESS", "ORGANIZATION"] as const;

const registerSchema = z.object({
  legalName: z.string().min(2, "Legal business name is required"),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  ownerName: z.string().min(1).optional(),
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
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { legalName, email, password, ownerName, country, accountType } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const org = await prisma.organization.create({
    data: {
      legalName,
      country,
      accountType,
      // Every new account starts unverified. KYB is not enforced anywhere
      // in the product yet, so this does not limit functionality.
      kybStatus: "PENDING",
      kybApprovedAt: null,
      kybApprovedBy: null,
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

  // Create the default bucket layout now, without a wallet. Failures are
  // logged rather than failing the whole signup - the account exists and
  // the buckets can be backfilled on the next wallet creation.
  try {
    await ensureDefaultBucketsForOrg(org.id, { accountType });
  } catch (err) {
    console.error(`[register] default bucket creation failed for org ${org.id}`, err);
  }

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

  // after() is no longer used here: signup does not provision a Circle
  // wallet. Wallet creation is an explicit user action (POST /api/wallet).

  return NextResponse.json(
    {
      organization: {
        id: org.id,
        legalName: org.legalName,
        country: org.country,
        accountType: org.accountType,
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