// app/(app)/wallet/unified-balance/deposit/UnifiedDepositForm.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const SOURCE_CHAINS: { value: string; label: string }[] = [
  { value: "ARC_TESTNET", label: "Arc Testnet" },
  { value: "ETH_SEPOLIA", label: "Ethereum Sepolia" },
  { value: "BASE_SEPOLIA", label: "Base Sepolia" },
  { value: "ARBITRUM_SEPOLIA", label: "Arbitrum Sepolia" },
];

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 90_000;

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

export default function UnifiedDepositForm({
  walletAddress,
  buckets,
  disabled,
}: {
  walletAddress: string;
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [sourceChain, setSourceChain] = useState(SOURCE_CHAINS[0].value);
  const [amount, setAmount] = useState("");
  // allocation amounts keyed by bucket id
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string; explorerUrl?: string } | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmedAfter, setConfirmedAfter] = useState<string | null>(null);
  const baselineConfirmedRef = useRef<number | null>(null);
  const depositedAmountRef = useRef<number>(0);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const allocSum = useMemo(() => {
    return Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }, [alloc]);

  useEffect(() => {
    if (!confirming || ready) return;
    const started = Date.now();
    let cancelled = false;

    async function poll() {
      while (!cancelled && Date.now() - started < POLL_TIMEOUT_MS) {
        try {
          const res = await fetch("/api/wallet/unified-balance");
          const data = await res.json();
          if (res.ok && !cancelled) {
            const confirmed = parseFloat(data.totalConfirmed ?? "0");
            const baseline = baselineConfirmedRef.current ?? 0;
            const target = baseline + Math.max(0, depositedAmountRef.current * 0.9);
            if (Number.isFinite(confirmed) && confirmed >= target && confirmed > baseline) {
              setConfirmedAfter(data.totalConfirmed ?? "0");
              setReady(true);
              setConfirming(false);
              router.refresh();
              return;
            }
            setConfirmedAfter(data.totalConfirmed ?? "0");
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled) {
        setConfirming(false);
        router.refresh();
      }
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, [confirming, ready, router]);

  function setBucketAmount(id: string, value: string) {
    setAlloc((prev) => ({ ...prev, [id]: value }));
  }

  function fillFromBucket(id: string, balance: string) {
    setAlloc((prev) => ({ ...prev, [id]: balance }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setReady(false);
    setConfirming(false);
    setConfirmedAfter(null);

    const total = parseFloat(amount);
    if (!amount || !Number.isFinite(total) || total <= 0) {
      setError("Enter a valid deposit amount.");
      return;
    }

    const allocations = Object.entries(alloc)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([ledgerAccountId, amt]) => ({
        ledgerAccountId,
        amount: amt.trim(),
      }));

    if (!allocations.length) {
      setError("Allocate the deposit across one or more buckets.");
      return;
    }

    const sum = allocations.reduce((s, a) => s + parseFloat(a.amount), 0);
    if (Math.abs(sum - total) > 0.000001) {
      setError(
        `Bucket allocations (${sum.toFixed(6)}) must equal the deposit amount (${total}).`
      );
      return;
    }

    setSubmitting(true);
    try {
      try {
        const balRes = await fetch("/api/wallet/unified-balance");
        const bal = await balRes.json();
        if (balRes.ok) {
          baselineConfirmedRef.current = parseFloat(bal.totalConfirmed ?? "0");
        } else {
          baselineConfirmedRef.current = 0;
        }
      } catch {
        baselineConfirmedRef.current = 0;
      }
      depositedAmountRef.current = total;

      const res = await fetch("/api/wallet/unified-balance/deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          sourceChain,
          amount: amount.trim(),
          allocations,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Deposit failed");
        return;
      }
      setResult(data.deposit);
      setConfirming(true);
      router.refresh();
    } catch {
      setError("Deposit failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 space-y-1">
          <p className="font-semibold">Deposit submitted — buckets debited.</p>
          <p className="font-mono text-xs break-all">{result.txHash}</p>
          {result.explorerUrl && (
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="underline">
              View on explorer
            </a>
          )}
        </div>
      )}

      {confirming && !ready && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-semibold">Waiting for confirmation…</p>
          <p className="text-xs text-blue-800/80 mt-1">
            Gateway is confirming your deposit.
            {confirmedAfter != null && (
              <> Current confirmed: <span className="font-mono">{confirmedAfter}</span> USDC.</>
            )}
          </p>
        </div>
      )}

      {ready && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 space-y-2">
          <p className="font-semibold">Ready to send</p>
          <p>
            Unified Balance confirmed
            {confirmedAfter != null && (
              <> at <span className="font-semibold">{confirmedAfter} USDC</span></>
            )}
            .
          </p>
          <Link href="/wallet/transfer" className="inline-flex text-xs font-semibold text-[#2A5CE6] hover:underline">
            Go to New transfer →
          </Link>
        </div>
      )}

      <div>
        <p className="text-xs text-[#7C8CA6] mb-2">
          Wallet <span className="font-mono text-[#3E4A6B]">{walletAddress}</span>
        </p>
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">Source chain</label>
        <div className="flex flex-wrap gap-1.5 rounded-full bg-[#FAF9F6] p-1 w-fit">
          {SOURCE_CHAINS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setSourceChain(c.value)}
              disabled={disabled || submitting || confirming}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                sourceChain === c.value ? "bg-[#2A5CE6] text-white" : "text-[#3E4A6B] hover:bg-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Total amount (USDC)
        </label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled || submitting || confirming}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-semibold text-[#0B1E3F]">Debit from buckets</label>
          <span className="text-xs text-[#7C8CA6]">
            Allocated {allocSum.toFixed(2)} / {amount || "0"}
          </span>
        </div>
        <div className="rounded-xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {buckets.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[#7C8CA6]">No buckets available.</p>
          ) : (
            buckets.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0B1E3F] truncate">{b.name}</p>
                  <p className="text-xs text-[#7C8CA6]">{b.balance} USDC</p>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#2A5CE6] hover:underline shrink-0"
                  disabled={disabled || submitting}
                  onClick={() => fillFromBucket(b.id, b.balance)}
                >
                  Max
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={alloc[b.id] ?? ""}
                  onChange={(e) => setBucketAmount(b.id, e.target.value)}
                  disabled={disabled || submitting || confirming}
                  className="w-24 px-2 py-1.5 rounded-lg border border-[#E5E9F2] text-sm text-right tabular-nums disabled:opacity-50"
                />
              </div>
            ))
          )}
        </div>
        <p className="text-xs text-[#7C8CA6]">
          Allocations must add up to the total. Those buckets are reduced when the deposit
          succeeds so ledger matches onchain.
        </p>
      </div>

      <button
        type="submit"
        disabled={disabled || submitting || confirming}
        className="btn-3d w-full"
        style={{
          "--btn-bg": "#2A5CE6",
          "--btn-bg-hover": "#2450d1",
          "--btn-edge": "#1A3FA8",
          "--btn-edge-hover": "#17358f",
          color: "#ffffff",
        } as React.CSSProperties}
      >
        {submitting ? "Depositing…" : confirming ? "Confirming…" : "Fund Unified Balance"}
      </button>
    </form>
  );
}
