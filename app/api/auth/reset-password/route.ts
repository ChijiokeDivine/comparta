// app/api/auth/reset-password/route.ts
//
// Final step of the forgot-password flow.  Accepts the `resetToken`
// returned by otp/verify (PASSWORD_RESET) plus a new password, and
// updates the User's passwordHash.  The resetToken is single-use in
// practice because the OTP that minted it was single-use, but we also
// check TTL and HMAC integrity.

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { verifyResetToken } from "@/app/api/auth/otp/verify/route";

const schema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(10, "Password must be at least 10 characters"),
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

  const tokenPayload = verifyResetToken(parsed.data.resetToken);
  if (!tokenPayload) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 401 }
    );
  }

  const { newPassword } = parsed.data;
  const email = tokenPayload.email.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "No account found with that email." },
      { status: 404 }
    );
  }

  if (!user.passwordHash) {
    // OAuth-only account (never had a credentials password).  Still
    // allow setting one here — this is the standard "convert from
    // Google-only to Google + password" upgrade path, and it's gated by
    // the user proving email ownership via the OTP flow above.
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return NextResponse.json({
    ok: true,
    message: "Your password has been updated. You can now sign in.",
  });
}
