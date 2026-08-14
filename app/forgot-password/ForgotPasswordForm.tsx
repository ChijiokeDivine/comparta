"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export default function ForgotPasswordForm() {
  const mounted = useIsClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [retryCooldown, setRetryCooldown] = useState<number | null>(null);

  function startCooldown(seconds: number) {
    setRetryCooldown(seconds);
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");

    const trimmed = email.trim();
    if (!trimmed) {
      setFormError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFormError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429 && data?.retryAfterSeconds) {
          startCooldown(Math.min(120, Math.max(1, data.retryAfterSeconds)));
        }
        setFormError(data?.error ?? "Failed to send reset code. Please try again.");
        return;
      }

      setSent(true);
      startCooldown(60);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`min-h-screen w-full flex ${mounted ? "ready" : ""} bg-white`}>
      <style>{`
        .anim-logo, .anim-welcome, .anim-form-header, .anim-form-field, .anim-form-button, .anim-form-link { opacity: 0; }
        input:focus { outline: none !important; box-shadow: none !important; }
        .ready .anim-logo { animation: slideDown 0.7s cubic-bezier(0.22,1,0.36,1) 0.1s forwards; }
        .ready .anim-welcome { animation: revealUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.3s forwards; }
        .ready .anim-form-header { animation: revealUp 0.8s cubic-bezier(0.22,1,0.36,1) 0.1s forwards; }
        .ready .anim-form-field:nth-child(1) { animation: revealUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.3s forwards; }
        .ready .anim-form-button { animation: springUp 0.65s cubic-bezier(0.34,1.45,0.64,1) 0.6s forwards; }
        .ready .anim-form-link { animation: scaleFade 0.7s cubic-bezier(0.22,1,0.36,1) 0.8s forwards; }
        @keyframes slideDown { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes revealUp { from { opacity:0; transform:translateY(24px); clip-path:inset(100% 0 0 0); } to { opacity:1; transform:translateY(0); clip-path:inset(0% 0 0 0); } }
        @keyframes scaleFade { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }
        @keyframes springUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .anim-form-field{ margin-top: 15px}
        .anim-form-field:nth-child(1){ margin-bottom: 25px}
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
            <h1 className="text-3xl md:text-4xl font-normal tracking-tight text-[#0B1E3F] mb-3">
              Reset password
            </h1>
            <p className="text-[#7C8CA6] mb-8 md:mb-10 text-sm md:text-base leading-relaxed">
              {sent
                ? "We've emailed a 6-digit reset code. Enter it on the next screen to set a new password."
                : "Enter the email you use to sign in. We'll send a 6-digit code to verify your account."}
            </p>
          </div>

          {formError && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          {sent && (
            <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              If a Comparta account exists with <span className="font-semibold">{email}</span>, we&apos;ve sent a 6-digit reset code.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-0">
            <div className="anim-form-field ">
              <label htmlFor="email" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Email</label>
              <input id="email" name="email" type="email"
                disabled={sent || loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base disabled:bg-[#F7F8FB] disabled:text-[#7C8CA6]"
                placeholder="you@company.com" required />
            </div>

            <button type="submit" disabled={loading || !!retryCooldown}
              className="anim-form-button btn-3d w-full"
              style={{
                '--btn-bg': '#2A5CE6',
                '--btn-bg-hover': '#2450d1',
                '--btn-edge': '#1A3FA8',
                '--btn-edge-hover': '#17358f',
                color: '#ffffff',
              } as React.CSSProperties}>
              {loading
                ? "Sending code…"
                : retryCooldown
                  ? `Resend available in ${retryCooldown}s`
                  : sent
                    ? "Resend reset code"
                    : "Send reset code"}
            </button>
          </form>

          {sent && (
            <button
              type="button"
              onClick={() => router.push(`/verify-otp?purpose=reset&email=${encodeURIComponent(email)}`)}
              className="btn-3d btn-3d--neutral w-full border border-[#E5E9F2]"
            >
              I have a code — verify now
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-mr-1">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          <p className="anim-form-link mt-8 md:mt-10 text-center text-[#7C8CA6] text-sm md:text-base">
            Remembered it?{" "}
            <Link href="/login" className="font-semibold text-[#0B1E3F] hover:underline">Back to Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
