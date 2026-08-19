"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { googleErrorMessage } from "./googleErrorMessage";

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export default function LoginPage() {
  const mounted = useIsClient();
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const googleError = googleErrorMessage(searchParams.get("error"));
  const displayedError = googleError || formError;
  const verifiedBanner =
    searchParams.get("verified") === "1";
  const passwordChangedBanner =
    searchParams.get("passwordChanged") === "1";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.error) {
        if (result.error === "CredentialsSignin") {
          setFormError("Invalid email or password.");
          setLoading(false);
          return;
        }

        if (result.error.toLowerCase().includes("verify your email")) {
          // Account exists but wasn't verified as of that sign-in attempt.
          // Resend the code, but check the response in case it got verified
          // in another tab between then and now.
          try {
            const resendRes = await fetch("/api/auth/verification/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const resendData = await resendRes.json().catch(() => ({}));

            if (resendData?.alreadyVerified) {
              setFormError("Your email is already verified - please sign in again.");
              setLoading(false);
              return;
            }
          } catch {
            // Resend failed to even reach the server — fall through to
            // /verify-otp anyway; the page's own "Resend" button can retry.
          }

          router.push(`/verify-otp?purpose=verify&email=${encodeURIComponent(email)}`);
          return;
        }

        setFormError(result.error);
        setLoading(false);
        return;
      }

      if (!result?.ok) {
        setFormError("Sign-in failed. Please try again.");
        setLoading(false);
        return;
      }

      router.refresh();
      router.replace("/dashboard");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setFormError("");
    setGoogleLoading(true);
    try {
      let providers: Record<string, unknown> | null = null;
      try {
        const res = await fetch("/api/auth/providers", { cache: "no-store" });
        if (res.ok) providers = await res.json().catch(() => null);
      } catch {
        // Network failure to read providers — fall through and let signIn
        // attempt to run anyway; if Google really is missing the POST will
        // just redirect back to /login with callbackUrl, which is the old
        // behaviour, so we're not making anything worse.
      }

      if (providers && !("google" in providers)) {
        setFormError(
          "Google sign-in isn't available on this server right now. " +
          "Please use your email and password, or try again later."
        );
        setGoogleLoading(false);
        return;
      }

      await signIn("google", { callbackUrl: "/dashboard" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Google login failed. Please try again.");
      setGoogleLoading(false);
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
        .continue-sec{ margin-bottom: 20px}
 
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
              Log in
            </h1>
            <p className="text-[#7C8CA6] mb-8 md:mb-10 text-sm md:text-base leading-relaxed">
              Welcome back. Sign in to your Comparta account.
            </p>
          </div>

          {verifiedBanner && (
            <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Email verified. You can now sign in to your Comparta account.
            </div>
          )}
          {passwordChangedBanner && !verifiedBanner && (
            <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password updated. Sign in with your new password.
            </div>
          )}

          {displayedError && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {displayedError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="anim-form-field ">
              <label htmlFor="email" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Email</label>
              <input id="email" name="email" type="email"
                className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base"
                placeholder="you@company.com" required />
            </div>

            <div className="anim-form-field">
              <label htmlFor="password" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Password</label>
              <input id="password" name="password" type="password"
                className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base"
                placeholder="Enter your password" required />
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
              {loading ? "Signing in…" : "Log in"}
            </button>
          </form>
          <p className=" text-right  text-[#7C8CA6] text-sm md:text-sm">
          
            <Link href="/forgot-password" className=" text-[#0B1E3F] hover:underline">Forgot password</Link>
          </p>
          <div className="relative continue-sec mt-4 md:mt-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#E5E9F2]" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-[#7C8CA6] text-xs md:text-sm">
                Or continue with
              </span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full btn-3d btn-3d--neutral w-full flex items-center justify-center gap-3 border border-[#E5E9F2]"
          >
            {googleLoading ? (
              <div className="w-5 h-5 border-2 border-[#7C8CA6] border-t-[#0B1E3F] rounded-full animate-spin" />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <p className="anim-form-link mt-8 md:mt-10 text-center text-[#7C8CA6] text-sm md:text-base">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-semibold text-[#0B1E3F] hover:underline">Sign up</Link>
          </p>
         
        </div>
      </div>
    </div>
  );
}


