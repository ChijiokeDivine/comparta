// app/onboarding/OnboardingForm.tsx
"use client";

import Link from "next/link";
import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";

// Returns true only once the component has hydrated on the client.
// Replaces the old `useState(false) + useEffect(() => setState(true), [])`
// pattern, which triggers React's "avoid setState in an Effect" lint since
// it's really just deriving "are we on the client yet" rather than
// synchronizing with an external system.
function useMounted() {
  return useSyncExternalStore(
    () => () => {}, // no-op subscribe: this value never changes after mount
    () => true, // client snapshot
    () => false // server snapshot
  );
}

// Shown after a Google sign-up/sign-in for a user whose session has
// onboardingCompleted === false (see auth.ts). Google only gives us email
// + name, so this collects the org/business details the credentials
// registration form (RegisterForm.tsx) already asks for up front.
export default function OnboardingForm() {
  const router = useRouter();
  const { data: session, status, update } = useSession();

  const mounted = useMounted();

  const [legalName, setLegalName] = useState("");

  // ownerName is *derived* from the session until the user actually types
  // in the field, rather than copied into state via an Effect. This avoids
  // the "calling setState synchronously within an effect" warning that
  // comes from mirroring a prop/session value into local state.
  const [ownerNameInput, setOwnerNameInput] = useState("");
  const [ownerNameEdited, setOwnerNameEdited] = useState(false);
  const ownerName = ownerNameEdited ? ownerNameInput : session?.user?.name ?? "";

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Redirect out if there's no session, or onboarding is already done -
  // this page shouldn't be reachable otherwise (see middleware note below).
  // This one's a legitimate Effect: it's synchronizing with the router, an
  // external system, not deriving component state.
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (session?.user?.onboardingCompleted) router.replace("/dashboard");
  }, [status, session, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!legalName.trim()) {
      setFieldErrors({ legalName: "Please enter your organization or business name." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName,
          ownerName: ownerName || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.issues?.fieldErrors) {
          const flat: Record<string, string> = {};
          for (const [key, arr] of Object.entries(data.issues.fieldErrors as Record<string, string[]>)) {
            if (Array.isArray(arr) && arr[0]) flat[key] = arr[0];
          }
          setFieldErrors(flat);
        }
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Flip the JWT's onboardingCompleted flag without a full re-login.
      await update({ onboardingCompleted: true });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
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

      {/* Left side image panel - identical to Login/Register */}
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
            <Image src="/img5.png" alt="Comparta" height={42} width={135} priority />
          </Link>
          <div className="anim-welcome pb-12">
            <h2 className="text-4xl md:text-5xl font-normal leading-tight tracking-tight mb-6">
              Almost there.
            </h2>
            <p className="text-white/80 leading-relaxed max-w-md md:text-lg">
              Just a couple more details and your Comparta account will be ready to go.
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
              Finish setting up
            </h1>
            <p className="text-[#7C8CA6] mb-8 md:mb-10 text-sm md:text-base leading-relaxed">
              {session?.user?.email
                ? `You're signed in as ${session.user.email}. Just need a couple more details.`
                : "Just a couple more details to get you started."}
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="anim-form-field">
              <label htmlFor="legalName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
                Organization / business name
              </label>
              <input
                id="legalName"
                type="text"
                placeholder="Acme Inc."
                value={legalName}
                onChange={(e) => { setLegalName(e.target.value); if (fieldErrors.legalName) setFieldErrors((s) => ({ ...s, legalName: "" })); }}
                required
                className={`w-full px-4 py-3 rounded-xl border transition-all text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base focus:border-[#2A5CE6] ${fieldErrors.legalName ? "border-red-300" : "border-[#E5E9F2]"}`}
              />
              {fieldErrors.legalName && <p className="mt-1.5 text-sm text-red-600">{fieldErrors.legalName}</p>}
            </div>

            <div className="anim-form-field">
              <label htmlFor="ownerName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
                Your full name
              </label>
              <input
                id="ownerName"
                type="text"
                autoComplete="name"
                placeholder="Jane Doe"
                value={ownerName}
                onChange={(e) => {
                  setOwnerNameEdited(true);
                  setOwnerNameInput(e.target.value);
                }}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] transition-all focus:border-[#2A5CE6] text-[#0B1E3F] placeholder:text-[#7C8CA6]/60 text-sm md:text-base"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="anim-form-button btn-3d w-full"
              style={{
                '--btn-bg': '#2A5CE6',
                '--btn-bg-hover': '#2450d1',
                '--btn-edge': '#1A3FA8',
                '--btn-edge-hover': '#17358f',
                color: '#ffffff',
              } as React.CSSProperties}
            >
              {submitting ? "Saving…" : "Continue to dashboard"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}