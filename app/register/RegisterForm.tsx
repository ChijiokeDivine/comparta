"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { googleErrorMessage } from "./googleErrorMessage";

type RegisterResponse = {
  error?: string;
  issues?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
  message?: string;
};

const STEPS = [
  { label: "Organization", title: "Tell us about your organization", hint: "Just a couple of quick details to get started." },
  { label: "Account", title: "Your sign-in email", hint: "We'll use this for login and important updates." },
  { label: "Security", title: "Secure your account", hint: "Pick a strong password you don't use elsewhere." },
];

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

export default function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mounted = useIsClient();

  const [legalName, setLegalName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [currentStep, setCurrentStep] = useState(1);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const stepRef = useRef<HTMLDivElement>(null);

  const googleError = googleErrorMessage(searchParams.get("error"));
  const displayedError = googleError || formError;

  useEffect(() => {
    stepRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [currentStep]);

  function resetMessages() {
    setFormError(null);
    setFieldErrors({});
    setStepErrors({});
  }

  function validateStep(step: number): boolean {
    const next: Record<string, string> = {};

    if (step === 1) {
      if (!legalName.trim()) next.legalName = "Please enter your organization or business name.";
    } else if (step === 2) {
      const t = email.trim();
      if (!t) next.email = "Email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) next.email = "Please enter a valid email address.";
    } else if (step === 3) {
      if (password.length < 10) next.password = "Password must be at least 10 characters.";
      if (!confirmPassword) next.confirmPassword = "Please confirm your password.";
      else if (password !== confirmPassword) next.confirmPassword = "Passwords do not match.";
    }

    setStepErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(currentStep)) return;
    setStepErrors({});
    setCurrentStep((s) => Math.min(s + 1, STEPS.length));
  }

  function goPrev() {
    setStepErrors({});
    setCurrentStep((s) => Math.max(s - 1, 1));
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();

    if (currentStep < STEPS.length) {
      goNext();
      return;
    }

    if (!validateStep(STEPS.length)) return;
    if (password !== confirmPassword) {
      setFormError("Passwords do not match");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName,
          ownerName: ownerName || undefined,
          email,
          password,
        }),
      });

      const data: RegisterResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.issues?.fieldErrors) {
          const flat: Record<string, string> = {};
          for (const [key, arr] of Object.entries(data.issues.fieldErrors)) {
            if (Array.isArray(arr) && arr[0]) flat[key] = arr[0];
          }
          setFieldErrors(flat);
          if (flat.legalName || flat.ownerName) setCurrentStep(1);
          else if (flat.email) setCurrentStep(2);
          else if (flat.password || flat.confirmPassword) setCurrentStep(3);
        }
        setFormError(data.error ?? "Registration failed");
        return;
      }

      // New flow: email must be verified before the first sign-in.
      // Redirect to /verify-otp with the email pre-filled so the user
      // can enter the 6-digit code we just sent.
      router.push(
        `/verify-otp?purpose=verify&email=${encodeURIComponent(email)}`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignUp() {
    resetMessages();
    setGoogleLoading(true);
    try {
      let providers: Record<string, unknown> | null = null;
      try {
        const res = await fetch("/api/auth/providers", { cache: "no-store" });
        if (res.ok) providers = await res.json().catch(() => null);
      } catch {
        // Network failure to read providers — fall through and let signIn
        // attempt to run anyway.
      }

      if (providers && !("google" in providers)) {
        setFormError(
          "Google sign-up isn't available on this server right now. " +
          "Please sign up with your email and password instead, or try again later."
        );
        setGoogleLoading(false);
        return;
      }

      await signIn("google", { callbackUrl: "/dashboard" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Google sign up failed");
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
        .ready .anim-form-field:nth-child(1) { animation: revealUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.05s forwards; }
        .ready .anim-form-field:nth-child(2) { animation: revealUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.18s forwards; }
        .ready .anim-form-button { animation: springUp 0.65s cubic-bezier(0.34,1.45,0.64,1) 0.32s forwards; }
        .ready .anim-form-link { animation: scaleFade 0.7s cubic-bezier(0.22,1,0.36,1) 0.5s forwards; }
        @keyframes slideDown { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes revealUp { from { opacity:0; transform:translateY(24px); clip-path:inset(100% 0 0 0); } to { opacity:1; transform:translateY(0); clip-path:inset(0% 0 0 0); } }
        @keyframes scaleFade { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }
        @keyframes springUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .wizard-step-enter { animation: slideIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes slideIn { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
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
            <Image src="/logo.png" alt="Comparta" height={36} width={150} priority={true} />
          </Link>
        </div>

        <div className="w-full max-w-md mx-auto">
          <div className="anim-form-header">
            <h1 className="text-3xl md:text-4xl font-normal tracking-tight text-[#0B1E3F] mb-3">
              Create account
            </h1>
      
          </div>

          

          {displayedError && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {displayedError}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-0" noValidate>
          

            {/* Fields */}
            <div key={currentStep} ref={stepRef} className="wizard-step-enter">
              {currentStep === 1 && (
                <>
                  <div className="anim-form-field">
                    <label htmlFor="legalName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Organization / business name</label>
                    <input
                      id="legalName"
                      type="text"
                      placeholder="Acme Inc."
                      value={legalName}
                      onChange={(e) => { setLegalName(e.target.value); if (stepErrors.legalName) setStepErrors((s) => ({ ...s, legalName: "" })); }}
                      required
                      className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${stepErrors.legalName || fieldErrors.legalName ? 'border-red-300' : 'border-[#E5E9F2]'}`}
                    />
                    <FieldError message={stepErrors.legalName || fieldErrors.legalName} />
                  </div>

                  <div className="anim-form-field">
                    <label htmlFor="ownerName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Your full name <span className="font-normal text-[#7C8CA6]">(optional)</span></label>
                    <input
                      id="ownerName"
                      type="text"
                      autoComplete="name"
                      placeholder="Jane Doe"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base"
                    />
                  </div>
                </>
              )}

              {currentStep === 2 && (
                <>
                  <div className="anim-form-field " style={{marginBottom:"25px"}}>
                    <label htmlFor="email" className="block text-sm font-semibold text-[#0B1E3F] mb-3">Work email</label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (stepErrors.email) setStepErrors((s) => ({ ...s, email: "" })); }}
                      required
                      className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${stepErrors.email || fieldErrors.email ? "border-red-300" : "border-[#E5E9F2]"}`}
                    />
                    <FieldError message={stepErrors.email || fieldErrors.email} />
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <div className="anim-form-field">
                    <label htmlFor="password" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Password <span className="font-normal text-[#7C8CA6]">(10 characters minimum)</span></label>
                    <input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Minimum 10 characters"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (stepErrors.password) setStepErrors((s) => ({ ...s, password: "" })); }}
                      required
                      minLength={10}
                      className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${stepErrors.password || fieldErrors.password ? "border-red-300" : "border-[#E5E9F2]"}`}
                    />
                    <FieldError message={stepErrors.password || fieldErrors.password} />
                  </div>

                  <div className="anim-form-field">
                    <label htmlFor="confirmPassword" className="block text-sm font-semibold text-[#0B1E3F] mb-2">Confirm password</label>
                    <input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); if (stepErrors.confirmPassword) setStepErrors((s) => ({ ...s, confirmPassword: "" })); }}
                      required
                      minLength={10}
                      className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${stepErrors.confirmPassword ? "border-red-300" : "border-[#E5E9F2]"}`}
                    />
                    <FieldError message={stepErrors.confirmPassword} />
                  </div>
                </>
              )}
            </div>

            {/* Navigation */}
            <div className={`flex gap-3 mt-2 ${currentStep === 1 ? "justify-end" : "justify-between"} anim-form-button`}>
              {currentStep > 1 && (
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={submitting}
                  className="btn-3d btn-3d--neutral border border-[#E5E9F2] shrink-0"
                  aria-label="Go to previous step"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-ml-1">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Back
                </button>
              )}

              {currentStep < STEPS.length ? (
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-3d"
                  style={{
                    '--btn-bg': '#2A5CE6',
                    '--btn-bg-hover': '#2450d1',
                    '--btn-edge': '#1A3FA8',
                    '--btn-edge-hover': '#17358f',
                    color: '#ffffff',
                  } as React.CSSProperties}
                >
                  Continue
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-mr-1">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-3d"
                  style={{
                    '--btn-bg': '#2A5CE6',
                    '--btn-bg-hover': '#2450d1',
                    '--btn-edge': '#1A3FA8',
                    '--btn-edge-hover': '#17358f',
                    color: '#ffffff',
                  } as React.CSSProperties}
                >
                  {submitting ? "Creating account…" : "Create account"}
                </button>
              )}
            </div>
          </form>

          <div className="relative continue-sec">
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
            type="button"
            onClick={handleGoogleSignUp}
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
                Sign up with Google
              </>
            )}
          </button>

          <p className="anim-form-link mt-8 md:mt-10 text-center text-[#7C8CA6] text-sm md:text-base">
            Already using Comparta?{" "}
            <Link href="/login" className="font-semibold text-[#0B1E3F] hover:underline">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

