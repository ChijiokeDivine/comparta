// app/(app)/wallet/unified-balance/deposit/UnifiedDepositForm.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Kept as a plain client-side list, same tradeoff as ../spend/UnifiedSpendForm.tsx
// — display-only; the API route independently validates against
// UNIFIED_BALANCE_SUPPORTED_CHAINS server-side.
const SOURCE_CHAINS: { value: string; label: string }[] = [
  { value: "ARC_TESTNET", label: "Arc Testnet" },
  { value: "ETH_SEPOLIA", label: "Ethereum Sepolia" },
  { value: "BASE_SEPOLIA", label: "Base Sepolia" },
  { value: "ARBITRUM_SEPOLIA", label: "Arbitrum Sepolia" },
  { value: "HYPEREVM_TESTNET", label: "HyperEVM Testnet" },
];

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

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    setSubmitting(true);
    try {
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
          <p className="text-xs text-green-700 pt-1">
            It may take a moment to appear as confirmed on the Wallet page.
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">Wallet address</label>
        <p className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] text-sm font-mono bg-[#F7F8FB] break-all">
          {walletAddress}
        </p>
        <p className="mt-1.5 text-xs text-[#7C8CA6]">
          Only USDC already at this address on the chosen chain can be deposited.
        </p>
      </div>

      <div>
        <label htmlFor="sourceChain" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Source chain
        </label>
        <select
          id="sourceChain"
          value={sourceChain}
          onChange={(e) => setSourceChain(e.target.value)}
          disabled={disabled || submitting}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {SOURCE_CHAINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
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
          disabled={disabled || submitting}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
        <p className="mt-1.5 text-xs text-[#7C8CA6]">
          Try a small amount first to confirm this works before depositing everything.
        </p>
      </div>

      <button
        type="submit"
        disabled={disabled || submitting}
        className="btn-3d w-full"
        style={{
          "--btn-bg": "#2A5CE6",
          "--btn-bg-hover": "#2450d1",
          "--btn-edge": "#1A3FA8",
          "--btn-edge-hover": "#17358f",
          color: "#ffffff",
        } as React.CSSProperties}
      >
        {submitting ? "Depositing…" : "Deposit"}
      </button>
    </form>
  );
}