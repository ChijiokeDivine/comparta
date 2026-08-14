// app/api/auth/forgot-password/send/route.ts
//
// Issue + email a PASSWORD_RESET OTP. Always responds with success even
// if the email has no User row (prevents account-enumeration attacks;
// the email silently won't go out — see sendEmailIfUserExists below).

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { issueOtp } from "@/lib/otp/service";
import { sendPasswordResetOtpEmail } from "@/lib/notifications/notify";

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

  const issued = await issueOtp(email, "PASSWORD_RESET");
  if (!issued.ok) {
    switch (issued.error) {
      case "RATE_LIMITED":
        return NextResponse.json(
          {
            error: "Too many reset requests. Please try again later.",
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
          { error: "Failed to generate reset code. Please try again." },
          { status: 500 }
        );
    }
  }

  // Only actually send the email if a real User owns this email.
  // Returns the same public 200 response either way (no account enumeration).
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (user && issued.code) {
    try {
      await sendPasswordResetOtpEmail({
        recipientEmail: email,
        code: issued.code,
      });
    } catch (err) {
      // Best-effort emailing; don't fail the request.  Operators watch
      // the [notify] log line emitted from notify.ts itself.
      console.error(
        `[forgot-password/send] email failed for ${email} (otpId=${issued.otpId})`,
        err
      );
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "If a Comparta account exists with that email, we've sent a 6-digit reset code.",
  });
}
