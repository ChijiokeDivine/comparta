"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

type Purpose = "reset" | "verify";

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function purposeLabel(p: Purpose): { title: string; hint: string; eyebrow: string } {
  if (p === "reset") {
    return {
      title: "Enter reset code",
      hint: "Enter the 6-digit code we emailed to reset your password.",
      eyebrow: "Password reset",
    };
  }
  return {
    title: "Verify your email",
    hint: "Enter the 6-digit code we emailed to confirm your account.",
    eyebrow: "Almost there",
  };
}

export default function VerifyOtpForm() {
  const mounted = useIsClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawPurpose = searchParams.get("purpose");
  const initialEmail = searchParams.get("email") ?? "";

  // Purpose from query, defaulting to "verify" if invalid/absent.
  const purpose: Purpose = rawPurpose === "reset" ? "reset" : "verify";
  const copy = useMemo(() => purposeLabel(purpose), [purpose]);

  const [email, setEmail] = useState(initialEmail);
  const [digits, setDigits] = useState<(string | null)[]>([null, null, null, null, null, null]);
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [retryCooldown, setRetryCooldown] = useState<number | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Auto-focus first empty slot on mount if email already known (pre-filled).
    if (email && mounted) {
      const idx = digits.findIndex((d) => d === null);
      const target = idx === -1 ? 0 : idx;
      inputRefs.current[target]?.focus();
    }
  }, [email, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  function startCooldown(seconds: number) {
    const clamped = Math.min(120, Math.max(1, seconds));
    setRetryCooldown(clamped);
    const id = setInterval(() => {
      setRetryCooldown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(id);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function setDigitAt(idx: number, val: string) {
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = val.length > 0 ? val.slice(-1) : null;
      return next;
    });
  }

  function handleDigitInput(idx: number, e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/\D/g, "");
    if (!v) {
      setDigitAt(idx, "");
      return;
    }
    // Paste case: user may have pasted the full 6 digits → fill all, focus last+1
    if (v.length >= 2) {
      const cleaned = v.slice(0, 6).split("");
      setDigits(() => {
        const next: (string | null)[] = [null, null, null, null, null, null];
        for (let i = 0; i < cleaned.length; i++) next[i] = cleaned[i];
        return next;
      });
      // Focus first empty after the paste length, or last slot
      const focusIdx = Math.min(6 - 1, cleaned.length);
      inputRefs.current[focusIdx]?.focus();
      return;
    }
    setDigitAt(idx, v);
    if (v && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  }

  function handleDigitKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      const hasValue = !!digits[idx];
      if (!hasValue && idx > 0) {
        // Move to previous slot and clear it (standard backspace-across-empty behavior)
        inputRefs.current[idx - 1]?.focus();
        setDigitAt(idx - 1, "");
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
      e.preventDefault();
    }
  }

  async function handleResend() {
    setFormError("");
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFormError("Please enter a valid email address first.");
      return;
    }
    setResendLoading(true);
    try {
      const endpoint =
        purpose === "reset"
          ? "/api/auth/forgot-password/send"
          : "/api/auth/verification/send";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 && data?.retryAfterSeconds) {
          startCooldown(data.retryAfterSeconds);
        }
        setFormError(data?.error ?? "Failed to resend code. Please try again.");
        return;
      }
      startCooldown(60);
      setDigits([null, null, null, null, null, null]);
      inputRefs.current[0]?.focus();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setResendLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setFormError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    const code = digits.map((d) => d ?? "").join("");
    if (code.length !== 6) {
      setFormError("Please enter all 6 digits of the code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, code, purpose }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Shake off the whole input (red highlight)
        setFormError(data?.error ?? "Verification failed. Please try again.");
        setDigits([null, null, null, null, null, null]);
        inputRefs.current[0]?.focus();
        return;
      }

      if (purpose === "reset") {
        const token = data?.resetToken;
        if (!token) {
          setFormError("Invalid server response. Please try again.");
          return;
        }
        router.push(`/reset-password?token=${encodeURIComponent(token)}`);
        return;
      }

      // purpose === "verify" — email is now verified; go to sign in.
      router.push("/login?verified=1");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const allFilled = digits.every((d) => d !== null);

  return (
    <div className={`min-h-screen w-full flex ${mounted ? "ready" : ""} bg-white`}>
      <style>{`
        .anim-logo, .anim-welcome, .anim-form-header, .anim-form-field, .anim-form-button, .anim-form-link { opacity: 0; }
        input:focus { outline: none !important; box-shadow: none !important; }
        .ready .anim-logo { animation: slideDown 0.7s cubic-bezier(0.22,1,0.36,1) 0.1s forwards; }
        .ready .anim-welcome { animation: revealUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.3s forwards; }
        .ready .anim-form-header { animation: revealUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.1s forwards; }
        .ready .anim-form-field:nth-child(1) { animation: revealUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.05s forwards; }
        .ready .anim-form-field:nth-child(2) { animation: revealUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.18s forwards; }
        .ready .anim-form-button { animation: springUp 0.65s cubic-bezier(0.34,1.45,0.64,1) 0.32s forwards; }
        .ready .anim-form-link { animation: scaleFade 0.7s cubic-bezier(0.22,1,0.36,1) 0.5s forwards; }
        @keyframes slideDown { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes revealUp { from { opacity:0; transform:translateY(24px); clip-path:inset(100% 0 0 0); } to { opacity:1; transform:translateY(0); clip-path:inset(0% 0 0 0); } }
        @keyframes scaleFade { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }
        @keyframes springUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .anim-form-field{ margin-top: 15px}
        .anim-form-field:nth-child(2){ margin-bottom: 25px}
        .anim-form-button{ margin-bottom: 25px}
      `}</style>

      {/* Left side image panel */}
      <div className="hidden md:flex md:w-1/2 relative overflow-hidden">
        <div
          className="absolute inset-0 w-full h-full object-cover object-center"
          style={{
            backgroundImage: `url('/skywoma.webp')`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
          }}
        />
        <div className="relative z-10 flex flex-col justify-between px-8 py-6 md:px-16 md:py-8 text-white">
          <Link href="/" className="anim-logo flex items-center gap-2">
            <Image src="/img5.png" alt="Comparta" height={42} width={135} />
          </Link>
          <div className="anim-welcome pb-12">
            <h2 className="text-4xl md:text-5xl font-normal leading-tight tracking-tight mb-6">
              Move money like<br />it&apos;s easy.
            </h2>
            <p className="text-white/80 leading-relaxed max-w-md md:text-lg">
              Comparta unifies invoicing, payments, payroll, and savings. Instant settlement, all from one account.
            </p>
          </div>
        </div>
      </div>

      {/* Right side form */}
      <div className="w-full md:w-1/2 flex flex-col justify-center px-4 py-8 sm:px-6 md:px-12 lg:px-16 bg-white">
        <div className="md:hidden mb-10">
          <Link href="/" className="anim-logo flex items-center gap-2 w-fit">
            <Image src="/logo.png" alt="Comparta" height={36} width={150} priority />
          </Link>
        </div>

        <div className="w-full max-w-md mx-auto">
          <div className="anim-form-header">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7C8CA6] mb-3 md:mb-4">{copy.eyebrow}</p>
            <h1 className="text-3xl md:text-4xl font-normal tracking-tight text-[#0B1E3F] mb-3">
              {copy.title}
            </h1>
            <p className="text-[#7C8CA6] mb-8 md:mb-10 text-sm md:text-base leading-relaxed">
              {copy.hint}
            </p>
          </div>

          {formError && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-0">
            <div className="anim-form-field">
              <label htmlFor="email" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Email</label>
              <input id="email" name="email" type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base"
                placeholder="you@company.com" required />
            </div>

            <div className="anim-form-field">
              <label htmlFor="otp-0" className="block text-sm font-semibold text-[#0B1E3F] mb-3">
                6-digit code
              </label>
              <div
                className="grid grid-cols-6 gap-2 md:gap-3"
                onPaste={(e) => {
                  // Paste handler on the root div: grab pasted text, try fill
                  const text = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "");
                  if (!text) return;
                  e.preventDefault();
                  const arr = text.slice(0, 6).split("");
                  setDigits(() => {
                    const next: (string | null)[] = [null, null, null, null, null, null];
                    for (let i = 0; i < arr.length; i++) next[i] = arr[i];
                    return next;
                  });
                  const focusIdx = Math.min(6 - 1, arr.length);
                  setTimeout(() => inputRefs.current[focusIdx]?.focus(), 0);
                }}
              >
                {digits.map((d, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={d ?? ""}
                    onChange={(e) => handleDigitInput(i, e)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    aria-label={`Digit ${i + 1}`}
                    className="w-full h-14 md:h-[60px] text-center text-2xl font-semibold tabular-nums rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F]"
                  />
                ))}
              </div>
            </div>

            <button type="submit" disabled={loading || !allFilled}
              className="anim-form-button btn-3d w-full"
              style={{
                '--btn-bg': '#2A5CE6',
                '--btn-bg-hover': '#2450d1',
                '--btn-edge': '#1A3FA8',
                '--btn-edge-hover': '#17358f',
                color: '#ffffff',
              } as React.CSSProperties}>
              {loading ? "Verifying…" : "Verify code"}
            </button>
          </form>

          <div className="text-center">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || !!retryCooldown}
              className="text-sm text-[#7C8CA6] hover:text-[#0B1E3F] transition-colors disabled:opacity-60"
            >
              {retryCooldown
                ? `Resend code in ${retryCooldown}s`
                : resendLoading
                  ? "Sending…"
                  : "Didn't get a code? Resend"}
            </button>
          </div>

          <p className="anim-form-link mt-8 md:mt-10 text-center text-[#7C8CA6] text-sm md:text-base">
            {purpose === "reset" ? (
            <>
              Remembered it?{" "}
              <Link href="/login" className="font-semibold text-[#0B1E3F] hover:underline">Back to Log in</Link>
            </>
          ) : (
            <>
              Already verified?{" "}
              <Link href="/login" className="font-semibold text-[#0B1E3F] hover:underline">Go to Log in</Link>
            </>
          )}
          </p>
        </div>
      </div>
    </div>
  );
}
