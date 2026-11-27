// app/(app)/payment-links/new/NewPaymentLinkForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Link2,
  Loader2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { formatUSDC } from "@/app/invoices/_components/format";
import { useFeedback } from "@/app/(app)/_components/FeedbackProvider";

interface Bucket {
  id: string;
  name: string;
}

const PRIMARY_BTN = {
  "--btn-bg": "#2A5CE6",
  "--btn-bg-hover": "#2450d1",
  "--btn-edge": "#1A3FA8",
  "--btn-edge-hover": "#17358f",
  color: "#ffffff",
} as React.CSSProperties;

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function isValidAmount(value: string): boolean {
  return /^\d+(\.\d{1,6})?$/.test(value.trim()) && Number(value) > 0;
}

export default function NewPaymentLinkForm({
  buckets,
  disabled,
}: {
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();
  const { cue } = useFeedback();

  const [type, setType] = useState<"FIXED_AMOUNT" | "OPEN_AMOUNT">("FIXED_AMOUNT");
  const [step, setStep] = useState<1 | 2>(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [receivingLedgerAccountId, setReceivingLedgerAccountId] = useState(
    buckets[0]?.id ?? ""
  );
  const [showLimits, setShowLimits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    url: string;
    type: "FIXED_AMOUNT" | "OPEN_AMOUNT";
    amount: string | null;
  } | null>(null);

  const selectedBucket = buckets.find((b) => b.id === receivingLedgerAccountId);
  const previewAmount =
    type === "OPEN_AMOUNT"
      ? "Customer chooses amount"
      : isValidAmount(amount)
        ? formatUSDC(amount)
        : "0.00 USDC";

  function toggleLimits() {
    if (disabled) return;
    cue("tap");
    const next = !showLimits;
    setShowLimits(next);
    if (!next) {
      setExpiresAt("");
      setMaxUses("");
    }
  }

  function validateDetails(): boolean {
    if (type === "FIXED_AMOUNT" && !isValidAmount(amount)) {
      setError("Enter an amount greater than zero.");
      cue("error");
      return false;
    }
    return true;
  }

  function validateDestination(): boolean {
    if (!receivingLedgerAccountId) {
      setError("Choose a bucket to receive payments into.");
      cue("error");
      return false;
    }
    if (expiresAt && expiresAt <= todayPlusDays(0)) {
      setError("Expiry date must be in the future.");
      cue("error");
      return false;
    }
    if (maxUses.trim() && (!/^\d+$/.test(maxUses.trim()) || Number(maxUses) <= 0)) {
      setError("Max uses must be a positive whole number.");
      cue("error");
      return false;
    }
    return true;
  }

  function goNext() {
    setError(null);
    if (step === 1) {
      if (!validateDetails()) return;
      cue("next");
      setDirection("forward");
      setStep(2);
    }
  }

  function goBack() {
    setError(null);
    if (step === 1) return;
    cue("back");
    setDirection("back");
    setStep(1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < 2) {
      goNext();
      return;
    }

    setError(null);
    if (!validateDetails() || !validateDestination()) return;

    cue("tap");
    setSubmitting(true);
    try {
      const res = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount: type === "FIXED_AMOUNT" ? amount.trim() : undefined,
          description: description.trim() || undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          maxUses: maxUses.trim() ? Number(maxUses) : undefined,
          receivingLedgerAccountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create payment link");
        cue("error");
        return;
      }
      setCreated({
        id: data.paymentLink.id,
        url: new URL(data.paymentLink.url, window.location.origin).toString(),
        type,
        amount: data.paymentLink.amount ?? null,
      });
      setCopied(false);
      cue("success");
    } catch {
      setError("Could not create payment link");
      cue("error");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    cue("tap");
    setCreated(null);
    setCopied(false);
    setStep(1);
    setDirection("forward");
    setType("FIXED_AMOUNT");
    setAmount("");
    setDescription("");
    setExpiresAt("");
    setMaxUses("");
    setShowLimits(false);
    setReceivingLedgerAccountId(buckets[0]?.id ?? "");
    setError(null);
  }

  if (created) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <style>{`
          @keyframes paymentLinkFadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes paymentLinkSuccessPop {
            0%   { opacity: 0; transform: scale(.6) }
            60%  { opacity: 1; transform: scale(1.08) }
            100% { opacity: 1; transform: scale(1) }
          }
          @keyframes paymentLinkSparkle {
            0%, 100% { transform: translateY(0) rotate(0deg); opacity: .7 }
            50%      { transform: translateY(-4px) rotate(10deg); opacity: 1 }
          }
        `}</style>

        <div className="flex flex-col items-center py-10 text-center animate-[paymentLinkFadeIn_.25s_ease]">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 animate-[paymentLinkSuccessPop_.5s_cubic-bezier(.22,1,.36,1)]">
            <CheckCircle2 size={42} strokeWidth={2.2} />
            <Sparkles
              size={18}
              className="absolute -right-2 -top-1 text-amber-400 animate-[paymentLinkSparkle_1.4s_ease-in-out_infinite]"
            />
          </div>

          <h2 className="mt-5 text-2xl font-semibold text-[#0B1E3F]">
            Payment link created
          </h2>
          <p className="mt-1 max-w-sm text-sm text-[#7C8CA6]">
            Share it with your customer and get paid.
          </p>

          <div className="mt-6 w-full max-w-sm rounded-2xl border border-[#E5E9F2] bg-white p-5 text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-[#7C8CA6]">
              Link
            </p>
            <p className="mt-1 truncate font-mono text-sm text-[#0B1E3F]">{created.url}</p>
            <button
              type="button"
              onClick={async () => {
                cue("tap");
                try {
                  await navigator.clipboard.writeText(created.url);
                  setCopied(true);
                } catch {
                  cue("error");
                }
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#E5E9F2] px-3 py-1.5 text-xs font-semibold text-[#3E4A6B] transition-colors hover:border-[#2A5CE6] hover:text-[#2A5CE6]"
            >
              {copied ? (
                <>
                  <Check size={13} strokeWidth={3} /> Copied
                </>
              ) : (
                <>
                  <Copy size={13} /> Copy link
                </>
              )}
            </button>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-[#F2F4F8] pt-3 text-sm">
              <span className="text-[#7C8CA6]">Amount</span>
              <span className="font-semibold text-[#0B1E3F]">
                {created.type === "FIXED_AMOUNT"
                  ? formatUSDC(created.amount ?? "0")
                  : "Open amount"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              cue("tap");
              router.push(`/payment-links/${created.id}`);
              router.refresh();
            }}
            className="btn-3d mt-7 w-full max-w-sm"
            style={PRIMARY_BTN}
          >
            View payment link
          </button>
          <button
            type="button"
            onClick={reset}
            className="mt-2 w-full max-w-sm rounded-xl px-4 py-2.5 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8]"
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <style>{`
        @keyframes paymentLinkReveal {
          from { opacity: 0; transform: translateY(-6px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes paymentLinkStepForward {
          from { opacity: 0; transform: translateX(24px) }
          to   { opacity: 1; transform: translateX(0) }
        }
        @keyframes paymentLinkStepBack {
          from { opacity: 0; transform: translateX(-24px) }
          to   { opacity: 1; transform: translateX(0) }
        }
      `}</style>

      <div>
        <button
          type="button"
          onClick={() => {
            cue("back");
            router.push("/payment-links");
          }}
          className="inline-flex items-center gap-1 text-sm font-medium text-[#2A5CE6] hover:underline"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Payment links
        </button>
        <h1 className="mt-3 text-xl font-semibold text-[#0B1E3F]">New payment link</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        <div
          key={step}
          className={`min-h-[360px] ${
            direction === "forward"
              ? "animate-[paymentLinkStepForward_.35s_cubic-bezier(.22,1,.36,1)]"
              : "animate-[paymentLinkStepBack_.35s_cubic-bezier(.22,1,.36,1)]"
          }`}
        >
          {step === 1 && (
            <div className="space-y-4 rounded-2xl border border-[#E5E9F2] bg-white p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FF] text-[#2A5CE6]">
                  <Link2 size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#0B1E3F]">What are you charging for?</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["FIXED_AMOUNT", "OPEN_AMOUNT"] as const).map((t) => {
                  const active = type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        cue("tap");
                        setType(t);
                      }}
                      className={`relative rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                        active
                          ? "border-[#2A5CE6] bg-[#EEF3FF] "
                          : "border-[#E5E9F2] bg-white hover:border-[#2A5CE6]"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-[#0B1E3F]">
                        {t === "FIXED_AMOUNT" ? "Fixed amount" : "Open amount"}
                      </span>
                      <span className="mt-0.5 block text-xs text-[#7C8CA6]">
                        {t === "FIXED_AMOUNT" ? "Charge one set price." : "Let the payer decide."}
                      </span>
                      {active && (
                        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#2A5CE6] text-white">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {type === "FIXED_AMOUNT" && (
                <div>
                  <label
                    htmlFor="amount"
                    className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                  >
                    Amount
                  </label>
                  <div className="relative">
                    <input
                      id="amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={disabled}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-[#E5E9F2] bg-white py-3 pl-4 pr-16 text-lg font-semibold text-[#0B1E3F] transition-shadow focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10 disabled:opacity-50"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#7C8CA6]">
                      USDC
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="description"
                  className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                >
                  Description <span className="font-normal text-[#7C8CA6]">(optional)</span>
                </label>
                <input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={disabled}
                  maxLength={500}
                  placeholder="e.g. Design retainer — May"
                  className="w-full rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm text-[#0B1E3F] transition-shadow focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10 disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-4 rounded-2xl border border-[#E5E9F2] bg-white p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FF] text-[#2A5CE6]">
                    <Wallet size={18} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#0B1E3F]">
                      Where should the money go?
                    </p>
                  </div>
                </div>

                <div className="relative">
                  <select
                    id="bucket"
                    value={receivingLedgerAccountId}
                    onChange={(e) => setReceivingLedgerAccountId(e.target.value)}
                    disabled={disabled}
                    className="w-full appearance-none rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 pr-10 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10 disabled:opacity-50"
                  >
                    {buckets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#7C8CA6]"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5">
                <button
                  type="button"
                  onClick={toggleLimits}
                  disabled={disabled}
                  className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F2F4F8] text-[#3E4A6B]">
                      <CalendarClock size={18} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[#0B1E3F]">
                        Optional limits
                      </span>
                      <span className="block text-xs text-[#7C8CA6]">
                        Add an expiry date or cap the number of uses.
                      </span>
                    </span>
                  </span>
                  {showLimits ? (
                    <ChevronUp size={18} className="shrink-0 text-[#7C8CA6]" />
                  ) : (
                    <ChevronDown size={18} className="shrink-0 text-[#7C8CA6]" />
                  )}
                </button>

                {showLimits && (
                  <div className="mt-4 grid animate-[paymentLinkReveal_.25s_ease] grid-cols-1 gap-4 border-t border-[#F2F4F8] pt-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="expiresAt"
                        className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                      >
                        Expires <span className="font-normal text-[#7C8CA6]">(optional)</span>
                      </label>
                      <input
                        id="expiresAt"
                        type="date"
                        value={expiresAt}
                        min={todayPlusDays(1)}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        disabled={disabled}
                        className="w-full rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="maxUses"
                        className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                      >
                        Max uses <span className="font-normal text-[#7C8CA6]">(optional)</span>
                      </label>
                      <input
                        id="maxUses"
                        type="number"
                        min={1}
                        step={1}
                        value={maxUses}
                        onChange={(e) => setMaxUses(e.target.value)}
                        disabled={disabled}
                        placeholder="Unlimited"
                        className="w-full rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10 disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#F2F4F8] pt-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={goBack}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8] disabled:opacity-50"
            >
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <span />
          )}

          {step < 2 ? (
            <button type="submit" className="btn-3d min-w-[150px]" style={PRIMARY_BTN}>
              Continue <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || submitting}
              className="btn-3d min-w-[170px]"
              style={PRIMARY_BTN}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Creating…
                </>
              ) : (
                <>Create payment link</>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
