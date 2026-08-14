// app/api/auth/verification/send/route.ts
//
// (Re-)send an EMAIL_VERIFICATION OTP.  Used by:
//   - the /verify-otp "Resend code" button for a user mid-signup
//   - future flows that need to re-verify an unverified account
//
// Rate-limited per (email, purpose) through the shared issueOtp pipeline.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { issueOtp } from "@/lib/otp/service";
import { sendEmailVerificationOtpEmail } from "@/lib/notifications/notify";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid email address", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Verify there's actually an unverified User for this email — otherwise
  // respond with the same public 200 (no enumeration) but skip the email.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true },
  });

  if (user?.emailVerified) {
    // Already verified — treat as no-op success, don't waste an OTP slot
    // or send a redundant email.
    return NextResponse.json({
      ok: true,
      alreadyVerified: true,
      message: "This email is already verified. You can sign in.",
    });
  }

  const issued = await issueOtp(email, "EMAIL_VERIFICATION");
  if (!issued.ok) {
    switch (issued.error) {
      case "RATE_LIMITED":
        return NextResponse.json(
          {
            error: "Too many verification requests. Please try again later.",
            retryAfterSeconds: issued.retryAfterSeconds,
          },
          { status: 429 }
        );
      case "COOLDOWN":
        return NextResponse.json(
          {
            error: "Please wait a moment before requesting another code.",
            retryAfterSeconds: issued.retryAfterSeconds,
          },
          { status: 429 }
        );
      default:
        return NextResponse.json(
          { error: "Failed to generate verification code. Please try again." },
          { status: 500 }
        );
    }
  }

  // Only email if there's a real (unverified) User.  No user = 200 ok but
  // no email (account enumeration).
  if (user && issued.code) {
    try {
      await sendEmailVerificationOtpEmail({
        recipientEmail: email,
        code: issued.code,
      });
    } catch (err) {
      console.error(
        `[auth/verification/send] email failed for ${email} (otpId=${issued.otpId})`,
        err
      );
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "If a Comparta account exists with that email, we've sent a 6-digit verification code.",
  });
}
