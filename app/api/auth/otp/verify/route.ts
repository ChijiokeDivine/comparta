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
  type OtpPurpose,
} from "@/lib/otp/service";
import { getEnv } from "@/lib/env";
import { createHmac, timingSafeEqual } from "node:crypto";

const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

// ── resetToken (shared helper — also imported by reset-password/route.ts) ─
//
// Layout: `${base64(jsonPayload)}.${hexHmac}`
//   - payload: { email, exp: epoch_ms }
//   - hmac key: NEXTAUTH_SECRET (same secret we use for JWT sessions)
//     This guarantees:
//       1. token can't be forged without the server secret
//       2. tampering is detected via timing-safe HMAC compare
//       3. server is stateless — no extra DB table needed

export function mintResetToken(email: string): string {
  const secret = getResetTokenSecret();
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + RESET_TOKEN_TTL_MS })
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyResetToken(token: unknown): { email: string } | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const secret = getResetTokenSecret();
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("hex");

  // Timing-safe compare against the HMAC only (both are equal-length
  // hex strings so we don't need to pad either side).
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: { email?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.email !== "string") return null;
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  return { email: payload.email };
}

function getResetTokenSecret(): string {
  const s = getEnv().NEXTAUTH_SECRET;
  if (!s) {
    // Dev fallback.  In production the env var is required (NextAuth
    // itself would refuse to start without it) so this branch is safe.
    return "dev-reset-token-fallback-secret-change-me";
  }
  // Domain-separated from session JWTs via fixed suffix — same secret
  // material, but a leaked session JWT can't double as a reset token.
  return `${s}|reset-token-v1`;
}
