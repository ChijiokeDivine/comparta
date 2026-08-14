// app/api/auth/otp/verify/route.ts
//
// Verify a 6-digit OTP.  Supports both purposes via `purpose` in body.
//
// Success responses:
//   - PASSWORD_RESET:   returns a short-lived, signed `resetToken` (JWT-ish
//                       opaque token we can verify in reset-password/route.ts
//                       without keeping extra state).
//   - EMAIL_VERIFICATION: marks the User.emailVerified column and returns
//                       { ok: true, verified: true } — caller then signs
//                       the user in (RegisterForm does signIn(credentials)).
//
// The returned resetToken is deliberately self-contained and short-lived
// (10 min) so /reset-password can accept it without an extra DB table:
// it's just `base64({ email, exp })` + HMAC.  We verify the HMAC on the
// reset side.  Same approach NextAuth session cookies use for JWTs.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  verifyOtp,
  parsePurposeFromQuery,
  mintResetToken,
  type OtpPurpose,
} from "@/lib/otp/service";

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/),
  purpose: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const purpose: OtpPurpose | null = parsePurposeFromQuery(parsed.data.purpose);
  if (!purpose) {
    return NextResponse.json({ error: "Invalid verification purpose" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const code = parsed.data.code;

  const result = await verifyOtp(email, purpose, code);
  if (!result.ok) {
    let message = "Invalid or expired verification code.";
    switch (result.reason) {
      case "EXPIRED":
        message = "This code has expired. Please request a new one.";
        break;
      case "ALREADY_USED":
        message = "This code has already been used.";
        break;
      case "MAX_ATTEMPTS":
        message = "Too many incorrect attempts. Please request a new code.";
        break;
      case "INVALID":
        message = "Incorrect code. Please check and try again.";
        break;
    }
    return NextResponse.json({ error: message, reason: result.reason }, { status: 400 });
  }

  // ── OTP verified — branch by purpose ────────────────────────────────

  if (purpose === "EMAIL_VERIFICATION") {
    const updated = await prisma.user.updateMany({
      where: { email, emailVerified: null },
      data: { emailVerified: new Date() },
    });

    // updated.count can be 0 if the User was already verified (harmless)
    // or if the email has no User row — but OTP can only be issued for
    // an existing User via register/route.ts, so that case is unreachable
    // in the normal flow.  We still respond success for idempotency.
    return NextResponse.json({
      ok: true,
      verified: true,
      alreadyVerified: updated.count === 0,
      purpose: "verify",
    });
  }

  // ── PASSWORD_RESET: mint a short-lived resetToken ───────────────────
  const token = mintResetToken(email);
  return NextResponse.json({
    ok: true,
    purpose: "reset",
    resetToken: token,
  });
}
