"use client";

// app/components/BankOnrampPanel.tsx
//
// Naira → USDC inside the Add funds modal. The user enters a naira amount,
// pays the Paj virtual account shown, and USDC lands in the org wallet.
// Chain support is driven by lib/config/pajChains.ts (Arc only today).

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Landmark,
  Loader2,
} from "lucide-react";
import { formatNaira } from "@/lib/config/pajChains";

interface Availability {
  available: boolean;
  reason: string | null;
  currency: string;
  chain: { id: string; label: string; tokenSymbol: string } | null;
  chains: Array<{ id: string; label: string; enabled: boolean }>;
}

interface Order {
  id: string;
  status: "INIT" | "PROCESSING" | "COMPLETED" | "ERROR";
  chain: string;
  currency: string;
  tokenAmount: string | null;
  fiatAmount: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  failureReason: string | null;
  createdAt: string;
}

const QUICK_AMOUNTS = [5000, 10000, 20000, 50000];

const CHAIN_LOGOS: Record<string, string> = {
  ARC: "/chain-logos/arc.svg",
  ETHEREUM: "/chain-logos/ethereum.png",
  BASE: "/chain-logos/base.png",
};

function sanitizeAmount(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function StatusLine({ status }: { status: Order["status"] }) {
  if (status === "COMPLETED") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <Check size={13} strokeWidth={3} /> Complete
      </span>
    );
  }
  if (status === "ERROR") {
    return (
      <span className="text-xs font-semibold text-red-600">Failed</span>
    );
  }
  if (status === "PROCESSING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2A5CE6]">
        <Loader2 size={13} className="animate-spin" /> Confirming
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
      Waiting
    </span>
  );
}

function CopyField({
  label,
  value,
  copyValue,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyValue: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#E5E9F2] bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7C8CA6]">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-base font-semibold text-[#0B1E3F] tabular-nums">
          {value}
        </p>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
            copied
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-[#E5E9F2] bg-white text-[#3E4A6B] hover:border-[#0B1E3F] hover:text-[#0B1E3F]"
          }`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <span className="sr-only">{copyValue}</span>
    </div>
  );
}

export default function BankOnrampPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [chainId, setChainId] = useState("ARC");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [availabilityRes, ratesRes] = await Promise.all([
          fetch("/api/paj/availability"),
          fetch("/api/paj/rates"),
        ]);
        const availabilityData = await availabilityRes.json();
        const ratesData = await ratesRes.json();

        if (cancelled) return;
        if (!availabilityRes.ok) {
          setLoadError(availabilityData.error ?? "Bank transfers are unavailable.");
          return;
        }
        setAvailability(availabilityData);
        if (availabilityData.chain?.id) setChainId(availabilityData.chain.id);
        if (ratesRes.ok) setRate(ratesData.onRampRate);
        else if (availabilityData.available) {
          setLoadError(ratesData.error ?? "Couldn't load today's rate.");
        }
      } catch {
        if (!cancelled) setLoadError("Couldn't load bank transfers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll an open order until Paj reports a terminal state.
  const activeOrderId = order?.id ?? null;
  const activeOrderStatus = order?.status ?? null;

  useEffect(() => {
    if (
      !activeOrderId ||
      activeOrderStatus === "COMPLETED" ||
      activeOrderStatus === "ERROR"
    ) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/paj/orders/${activeOrderId}?sync=1`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && res.ok && data.order) setOrder(data.order);
      } catch {
        // Transient - the next tick retries.
      }
    }, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeOrderId, activeOrderStatus]);

  useEffect(() => {
    if (order?.status === "COMPLETED" && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [order?.status, router]);

  const fiat = Number(amount);
  const receive = useMemo(() => {
    if (!rate || !Number.isFinite(fiat) || fiat <= 0) return null;
    return fiat / rate;
  }, [fiat, rate]);

  const enabledChains = availability?.chains.filter((chain) => chain.enabled) ?? [];

  async function handleCopy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access denied - the value is still visible.
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(fiat) || fiat <= 0) {
      setError("Enter an amount to continue.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/paj/onramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiatAmount: fiat, chain: chainId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start that deposit.");
        return;
      }
      setOrder(data.order);
    } catch {
      setError("Couldn't start that deposit.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#7C8CA6]">
        <Loader2 size={16} className="animate-spin" /> Loading bank transfer…
      </div>
    );
  }

  if (loadError || !availability?.available) {
    return (
      <div className="rounded-xl border border-[#E5E9F2] bg-[#FAF9F6] px-4 py-5 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#7C8CA6]">
          <Landmark size={18} />
        </div>
        <p className="text-sm font-medium text-[#0B1E3F]">
          {loadError ?? availability?.reason ?? "Bank transfers are unavailable."}
        </p>
      </div>
    );
  }

  if (order) {
    const done = order.status === "COMPLETED";
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#0B1E3F]">
            {done ? "Deposit complete" : "Pay from your bank app"}
          </p>
          <StatusLine status={order.status} />
        </div>

        <div className="rounded-xl border border-[#E5E9F2] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FAFBFD] text-[#2A5CE6]">
                <Landmark size={15} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#0B1E3F]">
                  {order.bankName ?? "Paj"}
                </p>
                <p className="truncate text-[11px] text-[#7C8CA6]">
                  {order.accountName}
                </p>
              </div>
            </div>
            <Image
              src="/usdc.png"
              alt="USDC"
              width={22}
              height={22}
              className="shrink-0 rounded-full"
            />
          </div>

          <CopyField
            label="Account number"
            value={order.accountNumber ?? "—"}
            copyValue={order.accountNumber ?? ""}
            copied={copied === "account"}
            onCopy={() => handleCopy("account", order.accountNumber ?? "")}
          />
          <CopyField
            label="Amount"
            value={formatNaira(order.fiatAmount)}
            copyValue={order.fiatAmount ?? ""}
            copied={copied === "amount"}
            onCopy={() => handleCopy("amount", order.fiatAmount ?? "")}
          />
        </div>

        {done ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3.5">
            <p className="text-sm font-semibold text-emerald-800">
              {order.tokenAmount ?? "—"} USDC added to your wallet
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-700">
              Settled on {order.chain}.
            </p>
          </div>
        ) : order.status === "ERROR" ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {order.failureReason ?? "This deposit couldn't be completed."}
          </div>
        ) : (
          <p className="rounded-xl bg-[#FAF9F6] px-4 py-3 text-[11px] leading-relaxed text-[#3E4A6B]">
            Send exactly {formatNaira(order.fiatAmount)}. We detect the transfer
            automatically and deliver USDC on {order.chain}.
          </p>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              setOrder(null);
              setAmount("");
              setError(null);
            }}
            className="flex-1 rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm font-semibold text-[#0B1E3F] hover:bg-[#F7F8FB] transition-colors"
          >
            {done ? "New deposit" : "Start over"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-3d flex-1"
            style={
              {
                "--btn-bg": "#2A5CE6",
                "--btn-bg-hover": "#2450d1",
                "--btn-edge": "#1A3FA8",
                "--btn-edge-hover": "#17358f",
                color: "#ffffff",
              } as React.CSSProperties
            }
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleCreate} className="space-y-4">
      <div>
        <label
          htmlFor="bank-deposit-amount"
          className="block text-sm font-semibold text-[#0B1E3F]"
        >
          Amount (NGN)
        </label>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[#7C8CA6]">
            ₦
          </span>
          <input
            id="bank-deposit-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
            placeholder="0.00"
            autoComplete="off"
            className="w-full rounded-xl border border-[#E5E9F2] py-3.5 pl-8 pr-4 text-base font-semibold text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_AMOUNTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(String(value))}
              className="rounded-full border border-[#E5E9F2] bg-white px-3 py-1 text-[11px] font-semibold text-[#3E4A6B] hover:border-[#2A5CE6] hover:text-[#2A5CE6] transition-colors"
            >
              {formatNaira(value)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-[#E5E9F2] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Image
            src={CHAIN_LOGOS[chainId] ?? "/chain-logos/arc.svg"}
            alt=""
            width={18}
            height={18}
            unoptimized
            className="h-[18px] w-[18px] object-contain"
          />
          <span className="text-sm text-[#0B1E3F]">
            Deliver on {availability.chain?.label ?? chainId}
          </span>
        </div>
        {enabledChains.length > 1 ? (
          <div className="flex gap-1 rounded-full bg-[#FAF9F6] p-0.5">
            {enabledChains.map((chain) => (
              <button
                key={chain.id}
                type="button"
                onClick={() => setChainId(chain.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  chainId === chain.id
                    ? "bg-[#2A5CE6] text-white"
                    : "text-[#3E4A6B] hover:bg-white"
                }`}
              >
                {chain.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="rounded-full bg-[#F2F4F8] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#7C8CA6]">
            {availability.chain?.tokenSymbol ?? "USDC"}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-[#E5EEFF] bg-[#F7FAFF] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-[#3E4A6B]">You receive</span>
          <span className="inline-flex items-center gap-1.5 text-base font-semibold text-[#0B1E3F] tabular-nums">
            <Image
              src="/usdc.png"
              alt="USDC"
              width={15}
              height={15}
              className="rounded-full"
            />
            {receive !== null ? receive.toFixed(2) : "0.00"} USDC
          </span>
        </div>
        {rate !== null && (
          <p className="mt-1 text-[11px] text-[#7C8CA6]">
            Rate: 1 USDC ≈ {formatNaira(rate)}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={creating || !(fiat > 0)}
        className="btn-3d w-full disabled:opacity-60"
        style={
          {
            "--btn-bg": "#2A5CE6",
            "--btn-bg-hover": "#2450d1",
            "--btn-edge": "#1A3FA8",
            "--btn-edge-hover": "#17358f",
            color: "#ffffff",
          } as React.CSSProperties
        }
      >
        {creating ? "Starting…" : "Continue"}
      </button>
    </form>
  );
}
