"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-sm text-red-600">{message}</p>;
}

export default function ResetPasswordForm() {
  const mounted = useIsClient();
  const searchParams = useSearchParams();

  const tokenFromUrl = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [apiTokenError, setApiTokenError] = useState<string | null>(null);

  // Derived, not stateful: purely a function of mounted + the URL param.
  const missingTokenError =
    mounted && !tokenFromUrl
      ? "This page can only be reached after verifying your 6-digit reset code. Please start the password reset flow again."
      : null;

  const tokenError = missingTokenError ?? apiTokenError;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (password.length < 10) next.password = "Password must be at least 10 characters.";
    if (!confirmPassword) next.confirmPassword = "Please confirm your password.";
    else if (password !== confirmPassword) next.confirmPassword = "Passwords do not match.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (tokenError) return;

    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resetToken: tokenFromUrl,
          newPassword: password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setApiTokenError(data?.error ?? "Your reset link is invalid or has expired. Please start the password reset flow again.");
          return;
        }
        if (data?.issues?.fieldErrors) {
          const flat: Record<string, string> = {};
          for (const [key, arr] of Object.entries(data.issues.fieldErrors as Record<string, string[]>)) {
            if (Array.isArray(arr) && arr[0]) flat[key] = arr[0];
          }
          setFieldErrors(flat);
        }
        setFormError(data?.error ?? "Failed to update password. Please try again.");
        return;
      }

      setDone(true);
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
        .ready .anim-form-field:nth-child(2) { animation: revealUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.45s forwards; }
        .ready .anim-form-button { animation: springUp 0.65s cubic-bezier(0.34,1.45,0.64,1) 0.6s forwards; }
        .ready .anim-form-link { animation: scaleFade 0.7s cubic-bezier(0.22,1,0.36,1) 0.8s forwards; }
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
            <h1 className="text-3xl md:text-4xl font-normal tracking-tight text-[#0B1E3F] mb-3">
              Set a new password
            </h1>
            <p className="text-[#7C8CA6] mb-8 md:mb-10 text-sm md:text-base leading-relaxed">
              {done
                ? "Your password has been updated. You can now sign in with your new password."
                : "Choose a strong password you don't use elsewhere. Minimum 10 characters."}
            </p>
          </div>

          {tokenError && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {tokenError}
              <div className="mt-4">
                <Link
                  href="/forgot-password"
                  className="btn-3d"
                  style={{
                    '--btn-bg': '#2A5CE6',
                    '--btn-bg-hover': '#2450d1',
                    '--btn-edge': '#1A3FA8',
                    '--btn-edge-hover': '#17358f',
                    color: '#ffffff',
                  } as React.CSSProperties}
                >
                  Start password reset again
                </Link>
              </div>
            </div>
          )}

          {done && (
            <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password updated successfully.
              <div className="mt-4">
                <Link
                  href="/login?passwordChanged=1"
                  className="btn-3d"
                  style={{
                    '--btn-bg': '#2A5CE6',
                    '--btn-bg-hover': '#2450d1',
                    '--btn-edge': '#1A3FA8',
                    '--btn-edge-hover': '#17358f',
                    color: '#ffffff',
                  } as React.CSSProperties}
                >
                  Go to Log in
                </Link>
              </div>
            </div>
          )}

          {formError && !done && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          {!done && !tokenError && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="anim-form-field ">
                <label htmlFor="password" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
                  New password <span className="font-normal text-[#7C8CA6]">(10 characters minimum)</span>
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Minimum 10 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((s) => ({ ...s, password: "" }));
                  }}
                  required
                  minLength={10}
                  className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${
                    fieldErrors.password ? "border-red-300" : "border-[#E5E9F2]"
                  }`}
                />
                <FieldError message={fieldErrors.password} />
              </div>

              <div className="anim-form-field">
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Confirm password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword) setFieldErrors((s) => ({ ...s, confirmPassword: "" }));
                  }}
                  required
                  minLength={10}
                  className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${
                    fieldErrors.confirmPassword ? "border-red-300" : "border-[#E5E9F2]"
                  }`}
                />
                <FieldError message={fieldErrors.confirmPassword} />
              </div>

              <button type="submit" disabled={loading}
                className="anim-form-button btn-3d w-full"
                style={{
                  '--btn-bg': '#2A5CE6',
                  '--btn-bg-hover': '#2450d1',
                  '--btn-edge': '#1A3FA8',
                  '--btn-edge-hover': '#17358f',
                  color: '#ffffff',
                } as React.CSSProperties}>
                {loading ? "Updating password…" : "Update password"}
              </button>
            </form>
          )}

          <p className="anim-form-link mt-8 md:mt-10 text-center text-[#7C8CA6] text-sm md:text-base">
            {done ? (
              <>
                Done?{" "}
                <Link href="/login" className="font-semibold text-[#0B1E3F] hover:underline">Log in</Link>
              </>
            ) : (
              <>
                Remembered it?{" "}
                <Link href="/login" className="font-semibold text-[#0B1E3F] hover:underline">Back to Log in</Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
