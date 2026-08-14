// lib/otp/service.ts
//
// 6-digit one-time passcode service.  Powers both:
//   - forgot-password (PASSWORD_RESET) flow
//   - new-account email verification (EMAIL_VERIFICATION) flow
//
// Security invariants (see also the Otp model docstring in schema.prisma):
//   - 15-minute TTL on every code
//   - single-use: successful verify sets consumedAt, making the row
//     invisible to every future lookup via findValidUnconsumed()
//   - per-purpose locking: a PASSWORD_RESET row cannot satisfy an
//     EMAIL_VERIFICATION challenge and vice versa
//   - per-(email+purpose) rate limits on issuance (5/hr, 60s cooldown)
//     to blunt spraying / repeated-resend abuse
//   - attempt count incremented on every wrong guess; rows with >=5
//     attempts are marked consumed-invalid so they can't be retried

import { prisma } from "@/lib/db/prisma";
import type { OtpPurpose } from "@/app/generated/prisma/client";
import { getEnv } from "@/lib/env";
import crypto from "node:crypto";

export type { OtpPurpose };

// ── Tunables ─────────────────────────────────────────────────────────────

const OTP_TTL_MS = 15 * 60 * 1000;           // 15 minutes
const MAX_ATTEMPTS_PER_OTP = 5;              // wrong-guess lockout per row
const MAX_ISSUANCES_PER_WINDOW = 5;          // 5 codes per email+purpose
const ISSUANCE_WINDOW_MS = 60 * 60 * 1000;   // per 1 hour
const RESEND_COOLDOWN_MS = 60 * 1000;        // 60s between successive sends

// ── Helpers ──────────────────────────────────────────────────────────────

/** 6-digit numeric OTP, cryptographically-sourced (no modulo bias). */
function generateOtpCode(): string {
  // 1_000_000 = 10^6.  randomInt below returns [0, max) exclusive,
  // which is exactly [0, 999999] for 6 digits.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

function now(): Date {
  return new Date();
}

function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

// ── Public API ───────────────────────────────────────────────────────────

export interface IssueOtpResult {
  ok: boolean;
  code?: string;
  otpId?: string;
  error?: "RATE_LIMITED" | "COOLDOWN" | "UNKNOWN";
  retryAfterSeconds?: number;
}

/**
 * Issues a fresh 6-digit OTP for `(email, purpose)`.
 *
 *   1. Invalidates every prior unconsumed row for the same (email, purpose)
 *      — at most one valid outstanding code per flow at a time.
 *   2. Rate-limits issuances to MAX_ISSUANCES_PER_WINDOW per rolling
 *      ISSUANCE_WINDOW_MS and enforces RESEND_COOLDOWN_MS between sends.
 *   3. Creates a new Otp row and returns its raw code.
 *
 * Caller is responsible for actually emailing the returned code
 * (see notify.ts: sendPasswordResetOtpEmail / sendEmailVerificationOtpEmail).
 */
export async function issueOtp(
  email: string,
  purpose: OtpPurpose
): Promise<IssueOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const t0 = now();
  const windowStart = addMs(t0, -ISSUANCE_WINDOW_MS);
  const cooldownCutoff = addMs(t0, -RESEND_COOLDOWN_MS);

  try {
    // ── Rate limit + cooldown check ───────────────────────────────────
    const recent = await prisma.otp.findMany({
      where: {
        email: normalizedEmail,
        purpose,
        createdAt: { gte: windowStart },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ISSUANCES_PER_WINDOW,
    });

    if (recent.length >= MAX_ISSUANCES_PER_WINDOW) {
      // Oldest issuance in the window tells us when the next slot frees up.
      const oldest = recent[recent.length - 1].createdAt;
      const retrySec = Math.max(
        1,
        Math.ceil((addMs(oldest, ISSUANCE_WINDOW_MS).getTime() - t0.getTime()) / 1000)
      );
      return { ok: false, error: "RATE_LIMITED", retryAfterSeconds: retrySec };
    }

    if (recent.length > 0) {
      const lastIssuedAt = recent[0].createdAt;
      if (lastIssuedAt.getTime() > cooldownCutoff.getTime()) {
        const retrySec = Math.max(
          1,
          Math.ceil((addMs(lastIssuedAt, RESEND_COOLDOWN_MS).getTime() - t0.getTime()) / 1000)
        );
        return { ok: false, error: "COOLDOWN", retryAfterSeconds: retrySec };
      }
    }

    // ── Invalidate prior unconsumed rows for the same (email, purpose) ─
    // Atomic with the insert so a concurrent verify can't read a stale
    // code after we've issued the new one.
    const code = generateOtpCode();
    const expiresAt = addMs(t0, OTP_TTL_MS);

    const [, created] = await prisma.$transaction([
      prisma.otp.updateMany({
        where: {
          email: normalizedEmail,
          purpose,
          consumedAt: null,
          expiresAt: { gt: t0 },
        },
        data: { consumedAt: t0 },
      }),
      prisma.otp.create({
        data: {
          email: normalizedEmail,
          purpose,
          code,
          expiresAt,
        },
        select: { id: true },
      }),
    ]);

    return { ok: true, code, otpId: created.id };
  } catch (err) {
    console.error(`[otp] issueOtp failed for ${purpose}/${normalizedEmail}`, err);
    return { ok: false, error: "UNKNOWN" };
  }
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "INVALID" | "EXPIRED" | "ALREADY_USED" | "MAX_ATTEMPTS" | "UNKNOWN"; attempts?: number };

/**
 * Verifies a 6-digit code for `(email, purpose)`.
 *
 * On success the matching row is consumed (consumedAt set).
 * On failure the row's attempt counter increments; rows that reach
 * MAX_ATTEMPTS_PER_OTP are also marked consumed (invalidate-on-lockout).
 *
 * Returns:
 *   - { ok: true }                        — correct code, row consumed
 *   - { ok: false, reason: "INVALID" }    — wrong code, attempts++
 *   - { ok: false, reason: "EXPIRED" }    — no unexpired row found
 *   - { ok: false, reason: "ALREADY_USED" }— code already consumed
 *   - { ok: false, reason: "MAX_ATTEMPTS" }— lockout threshold tripped
 */
export async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  code: string
): Promise<VerifyOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const trimmedCode = code.trim();
  const t0 = now();

  if (!/^\d{6}$/.test(trimmedCode)) {
    return { ok: false, reason: "INVALID" };
  }

  try {
    // Find any matching row for this email+purpose+code that is either
    // valid (unconsumed, not expired) OR at least still exists (for
    // meaningful ALREADY_USED / MAX_ATTEMPTS messaging).
    const rows = await prisma.otp.findMany({
      where: {
        email: normalizedEmail,
        purpose,
        code: trimmedCode,
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (rows.length === 0) {
      // No matching row at all — still bump attempts on the most recent
      // *active* row for (email,purpose) so brute-forcing codes isn't
      // free (each wrong guess consumes an attempt slot on the real
      // outstanding challenge).
      const latestActive = await prisma.otp.findFirst({
        where: {
          email: normalizedEmail,
          purpose,
          consumedAt: null,
          expiresAt: { gt: t0 },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, attempts: true },
      });
      if (latestActive) {
        await incrementAttemptsOrConsume(latestActive.id, latestActive.attempts);
      }
      return { ok: false, reason: "INVALID" };
    }

    const row = rows[0];

    if (row.consumedAt) {
      return { ok: false, reason: "ALREADY_USED" };
    }
    if (row.expiresAt.getTime() <= t0.getTime()) {
      return { ok: false, reason: "EXPIRED" };
    }
    if (row.attempts >= MAX_ATTEMPTS_PER_OTP) {
      return { ok: false, reason: "MAX_ATTEMPTS", attempts: row.attempts };
    }

    // ── Correct code: mark consumed ───────────────────────────────────
    await prisma.otp.update({
      where: { id: row.id },
      data: { consumedAt: t0 },
    });
    return { ok: true };
  } catch (err) {
    console.error(`[otp] verifyOtp failed for ${purpose}/${normalizedEmail}`, err);
    return { ok: false, reason: "UNKNOWN" };
  }
}

async function incrementAttemptsOrConsume(otpId: string, currentAttempts: number): Promise<void> {
  const next = currentAttempts + 1;
  if (next >= MAX_ATTEMPTS_PER_OTP) {
    // Locked out: mark consumed so the row is effectively dead.
    await prisma.otp.update({
      where: { id: otpId },
      data: { attempts: next, consumedAt: new Date() },
    });
  } else {
    await prisma.otp.update({
      where: { id: otpId },
      data: { attempts: next },
    });
  }
}

// ── Convenience: purpose parsing for URL query params ───────────────────

/**
 * Maps a URL ?purpose= query string to a valid OtpPurpose or null.
 * Pages use this so /verify-otp?purpose=reset routes through the same
 * shared form as /verify-otp?purpose=verify.
 */
export function parsePurposeFromQuery(raw: string | null | undefined): OtpPurpose | null {
  if (!raw) return null;
  switch (raw.toLowerCase()) {
    case "reset":
    case "password_reset":
    case "password-reset":
      return "PASSWORD_RESET";
    case "verify":
    case "email_verification":
    case "email-verification":
      return "EMAIL_VERIFICATION";
    default:
      return null;
  }
}

/** Inverse of parsePurposeFromQuery — the query-string value we put in URLs. */
export function purposeToQueryParam(purpose: OtpPurpose): "reset" | "verify" {
  return purpose === "PASSWORD_RESET" ? "reset" : "verify";
}

// ── Stateless HMAC-signed reset tokens ───────────────────────────────────
//
// After a PASSWORD_RESET OTP verifies, the server hands back a short-lived,
// self-contained token so /reset-password doesn't need an extra DB table.
// Layout: `${base64url(jsonPayload)}.${hexHmac}`.
//   payload: { email, exp: epoch_ms }
//   hmac key: NEXTAUTH_SECRET, domain-separated via suffix
// Same cryptographic posture NextAuth uses for session JWTs.

const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function mintResetToken(email: string): string {
  const secret = getResetTokenSecret();
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + RESET_TOKEN_TTL_MS })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

export function verifyResetToken(token: unknown): { email: string } | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const secret = getResetTokenSecret();
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("hex");

  // Timing-safe compare against the HMAC only. Both sides are equal-length
  // hex strings so no padding required.
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

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
    return "dev-reset-token-fallback-secret-change-me";
  }
  return `${s}|reset-token-v1`;
}
