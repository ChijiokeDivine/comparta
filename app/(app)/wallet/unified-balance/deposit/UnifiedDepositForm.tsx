// app/(app)/wallet/unified-balance/deposit/UnifiedDepositForm.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Kept as a plain client-side list, same tradeoff as ../spend/UnifiedSpendForm.tsx
// — display-only; the API route independently validates against
// UNIFIED_BALANCE_SUPPORTED_CHAINS server-side.
// Deposit sources only — HyperEVM is spend-destination-only (no DCW code).
const SOURCE_CHAINS: { value: string; label: string }[] = [
  { value: "ARC_TESTNET", label: "Arc Testnet" },
  { value: "ETH_SEPOLIA", label: "Ethereum Sepolia" },
  { value: "BASE_SEPOLIA", label: "Base Sepolia" },
  { value: "ARBITRUM_SEPOLIA", label: "Arbitrum Sepolia" },
];

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 90_000;

export default function UnifiedDepositForm({
  walletAddress,
  disabled,
}: {
  walletAddress: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [sourceChain, setSourceChain] = useState(SOURCE_CHAINS[0].value);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string; explorerUrl?: string } | null>(null);

  // Soft post-deposit confirmation: poll Unified Balance until confirmed
  // has grown (or timeout). Not a hard gate — just a clearer "ready" signal.
  const [confirming, setConfirming] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmedAfter, setConfirmedAfter] = useState<string | null>(null);
  const baselineConfirmedRef = useRef<number | null>(null);
  const depositedAmountRef = useRef<number>(0);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

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
            // Ready once confirmed has moved up by most of the deposit
            // (allow a small fee-sized lag) or simply exceeds baseline.
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
          // ignore transient poll errors
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled) {
        // Timed out — deposit may still confirm; don't alarm, just stop spinner.
        setConfirming(false);
        router.refresh();
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [confirming, ready, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setReady(false);
    setConfirming(false);
    setConfirmedAfter(null);

    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    setSubmitting(true);
    try {
      // Snapshot current confirmed balance before deposit so we can detect
      // when Gateway has absorbed this deposit.
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
      depositedAmountRef.current = parseFloat(amount) || 0;

      const res = await fetch("/api/wallet/unified-balance/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ sourceChain, amount: amount.trim() }),
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
          <p className="font-semibold">Deposit submitted.</p>
          <p className="font-mono text-xs break-all">{result.txHash}</p>
          {result.explorerUrl && (
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="underline">
              View on explorer
            </a>
          )}
        </div>
      )}

      {confirming && !ready && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 space-y-1">
          <p className="font-semibold">Waiting for confirmation…</p>
          <p className="text-xs text-blue-800/80">
            Gateway is confirming your deposit. This can take up to a minute.
            
          </p>
        </div>
      )}

      {ready && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 space-y-2">
          <p className="font-semibold">Ready to send</p>
          <p>
            Unified Balance is confirmed
            {confirmedAfter != null && (
              <> at <span className="font-semibold">{confirmedAfter} USDC</span></>
            )}
            . You can send cross-chain from New transfer.
          </p>
          <Link
            href="/wallet/transfer"
            className="inline-flex text-xs font-semibold text-[#2A5CE6] hover:underline"
          >
            Go to New transfer →
          </Link>
        </div>
      )}

      {!ready && result && !confirming && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Still confirming</p>
          <p className="text-xs mt-1">
            The deposit was submitted but confirmation is taking longer than usual.
            Check Unified Balance on the send page in a minute, or refresh this page.
          </p>
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
                sourceChain === c.value
                  ? "bg-[#2A5CE6] text-white"
                  : "text-[#3E4A6B] hover:bg-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Amount (USDC)
        </label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled || submitting || confirming}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
        <p className="mt-1.5 text-xs text-[#7C8CA6]">
          Deposit a bit more than you plan to send (network fees come from Unified Balance too).
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
        {submitting ? "Depositing…" : confirming ? "Confirming…" : "Deposit"}
      </button>
    </form>
  );
}
