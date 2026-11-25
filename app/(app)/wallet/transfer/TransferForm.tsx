// app/(app)/wallet/transfer/TransferForm.tsx
//
// One transfer surface for every way money leaves a bucket:
//   • to another person (wallet / @username / address)
//   • between your own buckets (internal ledger move)
//   • on a schedule (recurring transfer)
//   • out to a Nigerian bank (Paj payout)
//
// Presented as a small step flow (choose → details → review) instead of a
// single long form. Each step asks for the least it can, and every picker
// is a sheet on mobile / dialog on desktop.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Info,
  Landmark,
  Repeat,
  Search,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  TRANSFER_DESTINATION_CHAINS,
  SETTLEMENT_CHAIN,
} from "@/lib/config/clientChains";
import BankPayoutForm from "./_components/BankPayoutForm";
import type { Chain } from "@/app/generated/prisma/client";

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

interface Contact {
  id: string;
  displayName: string;
  identifier: string;
  identifierType: "USERNAME" | "ADDRESS";
}

interface ResolveResult {
  type: "USERNAME" | "ADDRESS";
  address: string;
  displayName: string | null;
  username: string | null;
}

type TransferType = "wallet" | "bucket" | "recurring" | "bank";
type Step = "intent" | "details" | "review" | "success";
type SheetKind = "from" | "to" | "schedule" | null;

const DESTINATION_CHAINS = TRANSFER_DESTINATION_CHAINS;

const FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
] as const;

type Frequency = (typeof FREQUENCIES)[number]["value"];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
};

const FREQUENCY_PHRASE: Record<Frequency, string> = {
  DAILY: "every day",
  WEEKLY: "every week",
  BIWEEKLY: "every 2 weeks",
  MONTHLY: "every month",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function truncateAddress(addr: string, start = 7, end = 7): string {
  if (addr.length <= start + end + 2) return addr;
  return `${addr.slice(0, start)}..${addr.slice(-end)}`;
}

// ── feedback (sound + haptics) ───────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function tone(freq: number, duration = 0.08, gain = 0.03, delay = 0) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

type Cue = "tap" | "next" | "back" | "success" | "error";

function useFeedback() {
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);

  useEffect(() => {
    try {
      setSound(localStorage.getItem("comparta:transfer:sound") !== "off");
      setHaptics(localStorage.getItem("comparta:transfer:haptics") !== "off");
    } catch {
      /* private mode */
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSound((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("comparta:transfer:sound", next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleHaptics = useCallback(() => {
    setHaptics((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("comparta:transfer:haptics", next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const cue = useCallback(
    (kind: Cue) => {
      if (haptics) {
        try {
          navigator.vibrate?.(
            kind === "success"
              ? [14, 40, 18]
              : kind === "error"
                ? [30]
                : kind === "tap"
                  ? 6
                  : 10
          );
        } catch {
          /* unsupported */
        }
      }
      if (!sound) return;
      if (kind === "tap") tone(560, 0.045, 0.018);
      else if (kind === "next") {
        tone(660, 0.06, 0.028);
        tone(880, 0.07, 0.02, 0.055);
      } else if (kind === "back") tone(420, 0.06, 0.02);
      else if (kind === "error") {
        tone(300, 0.09, 0.03);
        tone(220, 0.1, 0.025, 0.08);
      } else {
        tone(660, 0.09, 0.032);
        tone(880, 0.09, 0.028, 0.09);
        tone(1320, 0.14, 0.024, 0.18);
      }
    },
    [sound, haptics]
  );

  return { sound, haptics, toggleSound, toggleHaptics, cue };
}

// ── small UI primitives ──────────────────────────────────────────────────

function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true">
      <button
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[#0B1E3F]/40 backdrop-blur-[2px] animate-[fadeIn_.15s_ease]"
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center md:inset-0 md:items-center md:p-4">
        <div className="relative flex max-h-[88svh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-20px_60px_-15px_rgba(11,30,63,0.3)] animate-[slideUp_.24s_cubic-bezier(.22,1,.36,1)] md:max-h-[82vh] md:max-w-[460px] md:rounded-2xl md:shadow-[0_24px_80px_-20px_rgba(11,30,63,0.35)] md:animate-[popIn_.18s_ease]">
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-[#D8DEE9] md:hidden" />
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-3 md:pt-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#0B1E3F]">{title}</h2>
              {subtitle && (
                <p className="mt-0.5 text-xs text-[#7C8CA6]">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1.5 -mt-1 rounded-full p-2 text-[#7C8CA6] transition-colors hover:bg-[#F2F4F8] hover:text-[#0B1E3F]"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-[#F2F4F8] bg-[#FBFBFD] px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info size={13} className="text-[#A0AEC0]" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-52 -translate-x-1/2 rounded-lg bg-[#0B1E3F] px-2.5 py-1.5 text-[11px] font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function Row({
  label,
  value,
  sub,
  onClick,
  disabled,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#F7F8FB] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-[#7C8CA6]">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 text-right">
          <span
            className={`block truncate text-sm font-semibold ${
              muted ? "text-[#A0AEC0]" : "text-[#0B1E3F]"
            }`}
          >
            {value}
          </span>
          {sub && (
            <span className="block truncate text-[11px] text-[#7C8CA6]">{sub}</span>
          )}
        </span>
        <ChevronRight size={16} className="shrink-0 text-[#C4CDDB]" />
      </span>
    </button>
  );
}

// ── form ─────────────────────────────────────────────────────────────────

export default function TransferForm({
  buckets,
  disabled,
  canManage,
  initialType,
  initialTo,
  initialFrom,
}: {
  buckets: Bucket[];
  disabled: boolean;
  canManage: boolean;
  initialType?: TransferType;
  initialTo?: string;
  initialFrom?: string;
}) {
  const router = useRouter();
  const { sound, haptics, toggleSound, toggleHaptics, cue } = useFeedback();

  const startType = useMemo<TransferType | null>(() => {
    if (!initialType) return null;
    if (initialType === "bucket" && buckets.length < 2) return null;
    if (initialType === "recurring" && !canManage) return null;
    return initialType;
  }, [initialType, buckets.length, canManage]);

  const [type, setType] = useState<TransferType | null>(startType);
  const [step, setStep] = useState<Step>(startType ? "details" : "intent");
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initialFromId = (() => {
    const explicit = buckets.find((b) => b.id === initialFrom)?.id;
    if (explicit) return explicit;
    // "Move into this bucket" seeds `to` only — never pick that same bucket
    // as the source.
    const bucketTarget = startType === "bucket" ? initialTo : undefined;
    return buckets.find((b) => b.id !== bucketTarget)?.id ?? buckets[0]?.id ?? "";
  })();

  const [fromId, setFromId] = useState(initialFromId);
  const [toIdentifier, setToIdentifier] = useState(
    startType === "wallet" ? (initialTo ?? "") : ""
  );
  const [toBucketId, setToBucketId] = useState(() => {
    const seed = startType === "bucket" ? initialTo : undefined;
    return (
      buckets.find((b) => b.id === seed && b.id !== initialFromId)?.id ??
      buckets.find((b) => b.id !== initialFromId)?.id ??
      ""
    );
  });

  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  // Recurring
  const [recurringDest, setRecurringDest] = useState<"wallet" | "bucket">("wallet");
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState("");
  const [scheduleName, setScheduleName] = useState("");

  // Recipient resolution
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [destinationChain, setDestinationChain] = useState<Chain>(SETTLEMENT_CHAIN);

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactQuery, setContactQuery] = useState("");

  // Unified Balance (cross-chain sends only)
  const [ubConfirmed, setUbConfirmed] = useState<string | null>(null);
  const [ubPending, setUbPending] = useState<string | null>(null);
  const [ubLoading, setUbLoading] = useState(false);
  const [ubError, setUbError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const needsIdentifier =
    type === "wallet" || (type === "recurring" && recurringDest === "wallet");
  const isCrossChain =
    type === "wallet" &&
    destinationChain !== SETTLEMENT_CHAIN &&
    resolved?.type === "ADDRESS";

  const sourceBucket = buckets.find((b) => b.id === fromId) ?? null;
  const targetBucket = buckets.find((b) => b.id === toBucketId) ?? null;
  const bucketTargets = buckets.filter((b) => b.id !== fromId);

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.identifier.toLowerCase().includes(q)
    );
  }, [contacts, contactQuery]);

  // Resolve a seeded / deep-linked recipient once.
  useEffect(() => {
    if (startType === "wallet" && initialTo?.trim()) {
      void resolveIdentifier(initialTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contacts are only needed for identifier sends.
  useEffect(() => {
    if (sheet !== "to" || !needsIdentifier) return;
    let cancelled = false;
    setContactsLoading(true);
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setContacts(data.contacts ?? []);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sheet, needsIdentifier]);

  // Unified Balance only matters for a raw-address send to a non-Arc chain.
  useEffect(() => {
    if (!isCrossChain) {
      setUbConfirmed(null);
      setUbPending(null);
      setUbError(null);
      return;
    }
    let cancelled = false;
    setUbLoading(true);
    setUbError(null);
    fetch("/api/wallet/unified-balance")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load Unified Balance");
        if (cancelled) return;
        setUbConfirmed(data.totalConfirmed ?? "0");
        setUbPending(data.totalPending ?? "0");
      })
      .catch((err) => {
        if (cancelled) return;
        setUbError(err instanceof Error ? err.message : "Failed to load Unified Balance");
        setUbConfirmed(null);
        setUbPending(null);
      })
      .finally(() => {
        if (!cancelled) setUbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCrossChain, destinationChain]);

  async function resolveIdentifier(value: string): Promise<ResolveResult | null> {
    const v = value.trim();
    setResolved(null);
    setResolveError(null);
    if (!v) return null;

    setResolving(true);
    try {
      const res = await fetch(`/api/resolve/${encodeURIComponent(v)}`);
      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error ?? "Could not resolve this recipient");
        return null;
      }
      const result = data as ResolveResult;
      setResolved(result);
      if (result.type === "USERNAME") setDestinationChain(SETTLEMENT_CHAIN);
      return result;
    } catch {
      setResolveError("Could not resolve this recipient");
      return null;
    } finally {
      setResolving(false);
    }
  }

  function recipientLabel(r: ResolveResult | null): string {
    if (!r) return toIdentifier.trim() || "Choose recipient";
    if (r.type === "USERNAME") return `@${r.username ?? toIdentifier.trim()}`;
    return truncateAddress(r.address);
  }

  function setMax() {
    cue("tap");
    if (sourceBucket) setAmount(sourceBucket.balance);
  }

  function chooseType(next: TransferType) {
    cue("next");
    setType(next);
    setError(null);
    setStep("details");
  }

  function goBack() {
    cue("back");
    setError(null);
    if (step === "details" && startType) {
      // Deep-linked straight into a flow — send them to the picker.
      setType(null);
      setStep("intent");
      return;
    }
    setStep(step === "review" ? "details" : "intent");
  }

  function validate(r: ResolveResult | null): string | null {
    if (!type) return "Choose what you want to do.";
    if (!fromId) return "Choose a bucket to move from.";

    if (type === "bucket") {
      if (!toBucketId) return "Choose a bucket to move to.";
      if (fromId === toBucketId) return "Pick two different buckets.";
    }

    if (type === "recurring") {
      if (recurringDest === "bucket") {
        if (!toBucketId) return "Choose a destination bucket.";
        if (toBucketId === fromId) return "Pick two different buckets.";
      }
      if (!startDate) return "Pick a start date.";
      if (endDate && new Date(endDate).getTime() <= new Date(startDate).getTime()) {
        return "The end date must be after the start date.";
      }
    }

    if (needsIdentifier) {
      if (!toIdentifier.trim()) return "Add a recipient.";
      if (resolveError) return resolveError;
      if (!r) return "Check the recipient before continuing.";
    }

    const n = Number(amount.trim());
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      return "Enter an amount greater than zero.";
    }
    if (type === "bucket" && sourceBucket && n > Number(sourceBucket.balance)) {
      return "That's more than this bucket holds.";
    }
    if (isCrossChain) {
      const have = Number(ubConfirmed ?? "0");
      const pending = Number(ubPending ?? "0");
      if (ubLoading) return "Still reading Unified Balance — one moment.";
      if (ubError) return `Could not read Unified Balance: ${ubError}`;
      const total = have + pending;
      if (n > total) {
        return `Fund Unified Balance first — you have ${ubConfirmed ?? "0"} USDC confirmed.`;
      }
    }
    return null;
  }

  async function goReview() {
    setError(null);
    if (!type) return;

    if (type === "bank") return;

    let r = resolved;
    if (needsIdentifier) {
      if (!toIdentifier.trim()) {
        setError("Add a recipient.");
        cue("error");
        return;
      }
      if (!r) {
        r = await resolveIdentifier(toIdentifier);
        if (!r) {
          setError(resolveError ?? "Check the recipient before continuing.");
          cue("error");
          return;
        }
      }
    }

    const message = validate(r);
    if (message) {
      setError(message);
      cue("error");
      return;
    }

    cue("next");
    setStep("review");
  }

  async function submit() {
    if (!type) return;
    setSubmitting(true);
    setError(null);
    try {
      if (type === "wallet") {
        const useUnifiedBalance = isCrossChain;
        const res = await fetch(
          useUnifiedBalance ? "/api/wallet/unified-balance/spend" : "/api/transfers/send",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify(
              useUnifiedBalance
                ? {
                    fromLedgerAccountId: fromId || buckets[0]?.id,
                    toAddress: resolved?.address ?? toIdentifier,
                    destinationChain,
                    amount: amount.trim(),
                    memo: memo.trim() || undefined,
                  }
                : {
                    fromLedgerAccountId: fromId || buckets[0]?.id,
                    toIdentifier: toIdentifier.trim(),
                    amount: amount.trim(),
                    memo: memo.trim() || undefined,
                  }
            ),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Transfer failed");
      } else if (type === "bucket") {
        const res = await fetch("/api/ledger/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromLedgerAccountId: fromId,
            toLedgerAccountId: toBucketId,
            amount: amount.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Move failed");
      } else if (type === "recurring") {
        const res = await fetch("/api/dca", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceLedgerAccountId: fromId,
            ...(recurringDest === "bucket"
              ? { destinationLedgerAccountId: toBucketId }
              : { destinationIdentifier: toIdentifier.trim() }),
            amount: amount.trim(),
            frequency,
            startDate: new Date(startDate).toISOString(),
            endDate: endDate ? new Date(endDate).toISOString() : undefined,
            name: scheduleName.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not create recurring transfer");
      }

      cue("success");
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      cue("error");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    cue("tap");
    setType(null);
    setStep("intent");
    setAmount("");
    setMemo("");
    setToIdentifier("");
    setResolved(null);
    setResolveError(null);
    setError(null);
  }

  function finish() {
    cue("tap");
    if (type === "wallet") router.push("/wallet/transfers");
    else if (type === "recurring") router.push("/recurring");
    else router.push("/wallet");
    router.refresh();
  }

  const primaryLabel =
    type === "bucket" ? "Move" : type === "recurring" ? "Schedule" : "Send";

  // ── bank ───────────────────────────────────────────────────────────────

  if (type === "bank") {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            cue("back");
            setType(null);
            setStep("intent");
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#3E4A6B] hover:text-[#0B1E3F]"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <BankPayoutForm buckets={buckets} disabled={disabled} />
      </div>
    );
  }

  // ── shell ──────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(8px) scale(.97) }
          to   { opacity: 1; transform: translateY(0)   scale(1) }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(100%) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes checkPop {
          0%   { opacity: 0; transform: scale(.6) }
          60%  { opacity: 1; transform: scale(1.08) }
          100% { opacity: 1; transform: scale(1) }
        }
      `}</style>

      {/* Step chrome + feedback settings */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex min-h-8 items-center">
          {step !== "intent" && step !== "success" && (
            <button
              type="button"
              onClick={goBack}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8] hover:text-[#0B1E3F] disabled:opacity-50"
            >
              <ArrowLeft size={16} /> Back
            </button>
          )}
        </div>

        {step !== "success" && (
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {(["intent", "details", "review"] as Step[]).map((s) => {
              const active = s === step;
              return (
                <span
                  key={s}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    active ? "w-5 bg-[#2A5CE6]" : "w-1.5 bg-[#D8DEE9]"
                  }`}
                />
              );
            })}
          </div>
        )}

        <div className="relative flex min-h-8 items-center justify-end">
          <button
            type="button"
            onClick={() => {
              cue("tap");
              setSettingsOpen((o) => !o);
            }}
            aria-label="Sound and vibration"
            className="rounded-full p-2 text-[#7C8CA6] transition-colors hover:bg-[#F2F4F8] hover:text-[#0B1E3F]"
          >
            {sound || haptics ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-[#E5E9F2] bg-white p-1.5 shadow-[0_18px_50px_-12px_rgba(11,30,63,0.28)] animate-[popIn_.15s_ease]">
              <Toggle label="Sounds" checked={sound} onChange={toggleSound} />
              <Toggle label="Vibrations" checked={haptics} onChange={toggleHaptics} />
            </div>
          )}
        </div>
      </div>

      {/* ── intent ─────────────────────────────────────────────────────── */}
      {step === "intent" && (
        <div className="space-y-4 animate-[fadeIn_.2s_ease]">
          <div>
            <h2 className="text-lg font-semibold text-[#0B1E3F]">
              What are you moving?
            </h2>
            <p className="mt-0.5 text-sm text-[#7C8CA6]">
              Pick one — we&apos;ll keep the rest out of the way.
            </p>
          </div>

          <div className="space-y-2.5">
            <Option
              title="To someone"
              subtitle="@username or wallet address"
              icon={<Send size={18} />}
              onClick={() => chooseType("wallet")}
            />
            <Option
              title="Between buckets"
              subtitle="Instant, free, internal"
              icon={<ArrowRightLeft size={18} />}
              onClick={() => chooseType("bucket")}
              disabled={disabled || buckets.length < 2}
              hint={buckets.length < 2 ? "Create a second bucket first" : undefined}
            />
            {canManage && (
              <Option
                title="On a schedule"
                subtitle="Repeating transfer"
                icon={<Repeat size={18} />}
                onClick={() => chooseType("recurring")}
                disabled={disabled}
              />
            )}
            <Option
              title="To a Nigerian bank"
              subtitle="Cash out to naira"
              icon={<Landmark size={18} />}
              onClick={() => chooseType("bank")}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      {/* ── details ────────────────────────────────────────────────────── */}
      {step === "details" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void goReview();
          }}
          className="space-y-4 animate-[fadeIn_.2s_ease]"
        >
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5">
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-[#7C8CA6]">
                Amount
              </span>
              <InfoTip
                text={
                  isCrossChain
                    ? "Drawn from your Unified Balance and settled on the chosen chain."
                    : "USDC settles in seconds. Amount is shown in USDC."
                }
              />
            </div>
            <div className="mt-2 flex items-center justify-center gap-1">
              <span className="text-2xl font-light text-[#C4CDDB]">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))
                }
                disabled={disabled}
                placeholder="0.00"
                aria-label="Amount in USDC"
                className="w-full max-w-[200px] bg-transparent text-center text-4xl font-semibold tracking-tight text-[#0B1E3F] outline-none placeholder:font-normal placeholder:text-[#D8DEE9] disabled:opacity-50"
              />
              <span className="self-center text-sm font-semibold text-[#7C8CA6]">USDC</span>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
              {isCrossChain ? (
                <span className="flex items-center gap-1 text-[#7C8CA6]">
                  Unified Balance
                  <span className="font-semibold text-[#0B1E3F]">
                    {ubLoading ? "…" : `${ubConfirmed ?? "0"}`}
                  </span>
                  {ubPending && ubPending !== "0" && (
                    <span className="text-[#A0AEC0]">+{ubPending} pending</span>
                  )}
                </span>
              ) : (
                <>
                  <span className="text-[#7C8CA6]">
                    Available{" "}
                    <span className="font-semibold text-[#0B1E3F]">
                      {sourceBucket?.balance ?? "0"}
                    </span>{" "}
                    USDC
                  </span>
                  {(type === "bucket" || type === "recurring") && (
                    <button
                      type="button"
                      onClick={setMax}
                      disabled={disabled}
                      className="rounded-full bg-[#F2F4F8] px-2 py-0.5 font-semibold text-[#2A5CE6] transition-colors hover:bg-[#E5EBF7] disabled:opacity-50"
                    >
                      Max
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="divide-y divide-[#F2F4F8] overflow-hidden rounded-2xl border border-[#E5E9F2] bg-white">
            <Row
              label="From"
              value={
                isCrossChain
                  ? "Unified Balance"
                  : sourceBucket?.name ?? "Choose bucket"
              }
              sub={isCrossChain ? undefined : `${sourceBucket?.balance ?? "0"} USDC`}
              onClick={() => {
                if (isCrossChain) return;
                cue("tap");
                setSheet("from");
              }}
              disabled={disabled || isCrossChain}
              muted={isCrossChain}
            />

            <Row
              label="To"
              value={
                type === "bucket" || (type === "recurring" && recurringDest === "bucket")
                  ? targetBucket?.name ?? "Choose bucket"
                  : resolving
                    ? "Checking…"
                    : recipientLabel(resolved)
              }
              sub={
                recurringDest === "bucket" && type === "recurring"
                  ? `${targetBucket?.balance ?? "0"} USDC`
                  : resolved?.type === "USERNAME"
                    ? "Comparta user"
                    : isCrossChain
                      ? DESTINATION_CHAINS.find((c) => c.value === destinationChain)?.label
                      : undefined
              }
              onClick={() => {
                cue("tap");
                setSheet("to");
              }}
              disabled={disabled}
              muted={!!needsIdentifier && !toIdentifier.trim()}
            />

            {type === "recurring" && (
              <Row
                label="Repeats"
                value={`${FREQUENCY_LABEL[frequency]} · from ${formatDay(startDate)}`}
                onClick={() => {
                  cue("tap");
                  setSheet("schedule");
                }}
                disabled={disabled}
              />
            )}
          </div>

          {type === "wallet" && resolved?.type === "ADDRESS" && (
            <div className="rounded-2xl border border-[#E5E9F2] bg-white px-3.5 py-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6]">
                Network
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DESTINATION_CHAINS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      cue("tap");
                      setDestinationChain(c.value);
                    }}
                    disabled={disabled}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      destinationChain === c.value
                        ? "bg-[#2A5CE6] text-white"
                        : "bg-[#F2F4F8] text-[#3E4A6B] hover:bg-[#E5EBF7]"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === "wallet" && (
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={disabled}
              maxLength={500}
              placeholder="Add a note (optional)"
              aria-label="Note"
              className="w-full rounded-xl border border-transparent bg-transparent px-4 py-2 text-sm text-[#0B1E3F] placeholder:text-[#A0AEC0] focus:border-[#E5E9F2] focus:bg-white focus:outline-none disabled:opacity-50"
            />
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <button
            type="submit"
            disabled={disabled || submitting || resolving}
            className="btn-3d w-full"
            style={PRIMARY_BTN}
          >
            {resolving ? "Checking…" : "Review"}
            <ArrowRight size={16} className="ml-1.5 inline" />
          </button>
        </form>
      )}

      {/* ── review ─────────────────────────────────────────────────────── */}
      {step === "review" && (
        <div className="space-y-4 animate-[fadeIn_.2s_ease]">
          <div>
            <h2 className="text-lg font-semibold text-[#0B1E3F]">Confirm</h2>
            <p className="mt-0.5 text-sm text-[#7C8CA6]">
              One last look, then it&apos;s done.
            </p>
          </div>

          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5">
            <p className="text-center text-xs font-medium uppercase tracking-wider text-[#7C8CA6]">
              {type === "bucket" ? "Moving" : type === "recurring" ? "Each run" : "Sending"}
            </p>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              <Image src="/usdc.png" alt="USDC" width={22} height={22} className="rounded-full" />
              <span className="text-3xl font-bold tracking-tight text-[#0B1E3F] tabular-nums">
                {amount.trim() || "0.00"}
              </span>
              <span className="self-end pb-1 text-sm font-semibold text-[#7C8CA6]">USDC</span>
            </div>

            <div className="mt-5 space-y-2.5 text-sm">
              <SummaryRow
                label="From"
                value={isCrossChain ? "Unified Balance" : sourceBucket?.name ?? "—"}
              />
              <SummaryRow
                label="To"
                value={
                  type === "bucket" || (type === "recurring" && recurringDest === "bucket")
                    ? targetBucket?.name ?? "—"
                    : recipientLabel(resolved)
                }
              />
              {isCrossChain && (
                <SummaryRow
                  label="Network"
                  value={
                    DESTINATION_CHAINS.find((c) => c.value === destinationChain)?.label ?? "—"
                  }
                />
              )}
              {type === "recurring" && (
                <>
                  <SummaryRow
                    label="Repeats"
                    value={FREQUENCY_LABEL[frequency]}
                  />
                  <SummaryRow
                    label="Starts"
                    value={formatDay(startDate)}
                  />
                  {endDate && <SummaryRow label="Ends" value={formatDay(endDate)} />}
                  {scheduleName.trim() && (
                    <SummaryRow label="Name" value={scheduleName.trim()} />
                  )}
                </>
              )}
              {type === "wallet" && memo.trim() && (
                <SummaryRow label="Note" value={memo.trim()} />
              )}
            </div>
          </div>

          {type === "bucket" && (
            <p className="flex items-start gap-2 rounded-xl bg-[#F2F7FF] px-3.5 py-2.5 text-xs leading-relaxed text-[#3E4A6B]">
              <ArrowRightLeft size={14} className="mt-0.5 shrink-0 text-[#2A5CE6]" />
              Internal move — instant and free. Nothing leaves Comparta.
            </p>
          )}

          {isCrossChain && ubConfirmed != null && (
            <p className="flex items-start gap-2 rounded-xl bg-[#FFF8EC] px-3.5 py-2.5 text-xs leading-relaxed text-[#8A5A00]">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Drawn from Unified Balance ({ubConfirmed} USDC confirmed).{" "}
                <Link
                  href="/wallet/unified-balance/deposit"
                  className="font-semibold underline underline-offset-2"
                >
                  Fund it
                </Link>
              </span>
            </p>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || submitting}
            className="btn-3d w-full"
            style={PRIMARY_BTN}
          >
            {submitting ? "Working…" : primaryLabel}
          </button>

          <button
            type="button"
            onClick={goBack}
            disabled={submitting}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8] disabled:opacity-50"
          >
            Go back
          </button>
        </div>
      )}

      {/* ── success ────────────────────────────────────────────────────── */}
      {step === "success" && (
        <div className="flex flex-col items-center px-2 py-8 text-center animate-[fadeIn_.2s_ease]">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 animate-[checkPop_.4s_cubic-bezier(.22,1,.36,1)]">
            <CheckCircle2 size={34} strokeWidth={2.2} />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[#0B1E3F]">
            {type === "bucket"
              ? "Money moved"
              : type === "recurring"
                ? "Schedule created"
                : "Sent"}
          </h2>
          <p className="mt-1 max-w-[280px] text-sm text-[#7C8CA6]">
            {amount.trim()} USDC{" "}
            {type === "bucket"
              ? `moved to ${targetBucket?.name ?? "the bucket"}`
              : type === "recurring"
                ? FREQUENCY_PHRASE[frequency]
                : "is on its way"}
            .
          </p>

          <button
            type="button"
            onClick={finish}
            className="btn-3d mt-7 w-full"
            style={PRIMARY_BTN}
          >
            Done
          </button>
          <button
            type="button"
            onClick={reset}
            className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8]"
          >
            Make another
          </button>
        </div>
      )}

      {/* ── sheets ─────────────────────────────────────────────────────── */}

      <Sheet
        open={sheet === "from"}
        title={type === "bucket" ? "Move from" : "Pay from"}
        subtitle="Pick the bucket the money leaves"
        onClose={() => setSheet(null)}
      >
        <BucketList
          buckets={buckets}
          selectedId={fromId}
          onSelect={(id) => {
            cue("tap");
            setFromId(id);
            if (id === toBucketId) {
              setToBucketId(buckets.find((b) => b.id !== id)?.id ?? "");
            }
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet
        open={sheet === "to"}
        title={
          type === "bucket" || (type === "recurring" && recurringDest === "bucket")
            ? "Move to"
            : "Send to"
        }
        subtitle={
          needsIdentifier ? "A @username or wallet address" : "Pick a bucket"
        }
        onClose={() => setSheet(null)}
        footer={
          needsIdentifier ? (
            <button
              type="button"
              onClick={async () => {
                if (toIdentifier.trim()) await resolveIdentifier(toIdentifier);
                setSheet(null);
              }}
              className="w-full rounded-xl bg-[#2A5CE6] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2450d1]"
            >
              Use this recipient
            </button>
          ) : undefined
        }
      >
        {type === "recurring" && (
          <div className="mb-3 flex rounded-xl bg-[#F2F4F8] p-1">
            {(["wallet", "bucket"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  cue("tap");
                  setRecurringDest(d);
                  setResolved(null);
                  setResolveError(null);
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  recurringDest === d
                    ? "bg-white text-[#0B1E3F] shadow-sm"
                    : "text-[#7C8CA6]"
                }`}
              >
                {d === "wallet" ? "Wallet" : "Bucket"}
              </button>
            ))}
          </div>
        )}

        {needsIdentifier ? (
          <div className="space-y-3">
            <div className="relative">
              <input
                autoFocus
                value={toIdentifier}
                onChange={(e) => {
                  const val = e.target.value;
                  setToIdentifier(val.startsWith("@") ? val.slice(1) : val);
                  setResolved(null);
                  setResolveError(null);
                }}
                placeholder="@username or 0x1234…"
                className="w-full rounded-xl border border-[#E5E9F2] px-4 py-3 pr-10 text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
              />
              {resolved && (
                <Check
                  size={16}
                  strokeWidth={3}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-600"
                />
              )}
            </div>
            {resolving && <p className="text-xs text-[#7C8CA6]">Checking…</p>}
            {resolveError && <p className="text-xs text-red-600">{resolveError}</p>}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6]">
                  Contacts
                </p>
                <Link
                  href="/contacts/new"
                  className="text-[11px] font-semibold text-[#2A5CE6] hover:underline"
                >
                  Add
                </Link>
              </div>
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#F2F4F8] bg-[#FBFBFD] px-2.5 py-2">
                <Search size={14} className="shrink-0 text-[#7C8CA6]" />
                <input
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search contacts"
                  className="w-full bg-transparent text-xs text-[#0B1E3F] placeholder:text-[#A0AEC0] focus:outline-none"
                />
              </div>
              {contactsLoading ? (
                <p className="py-4 text-center text-xs text-[#7C8CA6]">Loading…</p>
              ) : filteredContacts.length === 0 ? (
                <p className="py-4 text-center text-xs text-[#7C8CA6]">
                  {contacts.length === 0 ? "No saved contacts yet." : "No matches."}
                </p>
              ) : (
                <ul className="-mx-1 max-h-56 overflow-y-auto">
                  {filteredContacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={async () => {
                          cue("tap");
                          setToIdentifier(c.identifier);
                          setResolved(null);
                          await resolveIdentifier(c.identifier);
                          setSheet(null);
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[#F7F8FB]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[#0B1E3F]">
                            {c.displayName}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-[#7C8CA6]">
                            {c.identifier}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-[#F2F4F8] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#7C8CA6]">
                          {c.identifierType === "USERNAME" ? "User" : "Address"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <BucketList
            buckets={bucketTargets}
            selectedId={toBucketId}
            onSelect={(id) => {
              cue("tap");
              setToBucketId(id);
              setSheet(null);
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={sheet === "schedule"}
        title="Repeat"
        subtitle="How often, and from when"
        onClose={() => setSheet(null)}
        footer={
          <button
            type="button"
            onClick={() => {
              cue("next");
              setSheet(null);
            }}
            className="w-full rounded-xl bg-[#2A5CE6] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2450d1]"
          >
            Done
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6]">
              Frequency
            </p>
            <div className="grid grid-cols-2 gap-2">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => {
                    cue("tap");
                    setFrequency(f.value);
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    frequency === f.value
                      ? "border-[#2A5CE6] bg-[#EEF2FF] text-[#2A5CE6]"
                      : "border-[#E5E9F2] text-[#3E4A6B] hover:border-[#2A5CE6]"
                  }`}
                >
                  {frequency === f.value && <Check size={14} strokeWidth={3} />}
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6]">
                <CalendarClock size={12} /> Starts
              </span>
              <input
                type="date"
                value={startDate}
                min={todayIso()}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-[#E5E9F2] px-3 py-2.5 text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6]">
                Ends <span className="normal-case text-[#A0AEC0]">(optional)</span>
              </span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-[#E5E9F2] px-3 py-2.5 text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6]">
              Name <span className="normal-case text-[#A0AEC0]">(optional)</span>
            </span>
            <input
              value={scheduleName}
              onChange={(e) => setScheduleName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Owner draw"
              className="w-full rounded-xl border border-[#E5E9F2] px-3 py-2.5 text-sm text-[#0B1E3F] placeholder:text-[#A0AEC0] focus:border-[#2A5CE6]"
            />
          </label>
        </div>
      </Sheet>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

const PRIMARY_BTN = {
  "--btn-bg": "#2A5CE6",
  "--btn-bg-hover": "#2450d1",
  "--btn-edge": "#1A3FA8",
  "--btn-edge-hover": "#17358f",
  color: "#ffffff",
} as React.CSSProperties;

function Option({
  title,
  subtitle,
  icon,
  onClick,
  disabled,
  hint,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border border-[#E5E9F2] bg-white p-3.5 text-left transition-all hover:border-[#C7D6F5] hover:bg-[#FAFBFE] active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#E5E9F2] disabled:hover:bg-white"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#2A5CE6]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#0B1E3F]">{title}</span>
        <span className="block truncate text-xs text-[#7C8CA6]">
          {hint ?? subtitle}
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-[#C4CDDB]" />
    </button>
  );
}

function BucketList({
  buckets,
  selectedId,
  onSelect,
}: {
  buckets: Bucket[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (buckets.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[#7C8CA6]">
        No buckets available.
      </p>
    );
  }
  return (
    <ul className="-mx-1 space-y-0.5">
      {buckets.map((b) => {
        const active = b.id === selectedId;
        return (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onSelect(b.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                active ? "bg-[#EEF2FF]" : "hover:bg-[#F7F8FB]"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#0B1E3F]">
                  {b.name}
                </span>
                <span className="block text-[11px] tabular-nums text-[#7C8CA6]">
                  {b.balance} USDC
                </span>
              </span>
              {active && <Check size={16} strokeWidth={3} className="shrink-0 text-[#2A5CE6]" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-[#7C8CA6]">
        {label}
      </span>
      <span className="min-w-0 break-words text-right text-sm font-semibold text-[#0B1E3F]">
        {value}
      </span>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-red-700"
    >
      {children}
    </p>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm text-[#0B1E3F] transition-colors hover:bg-[#F7F8FB]"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? "bg-[#2A5CE6]" : "bg-[#D8DEE9]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
