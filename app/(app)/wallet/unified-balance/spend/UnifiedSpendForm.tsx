// app/(app)/wallet/unified-balance/spend/UnifiedSpendForm.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

// Kept as a plain client-side list rather than fetched from the server,
// same tradeoff as TransferForm.tsx not fetching enum metadata — this is
// display-only; the API route independently validates against
// UNIFIED_BALANCE_SUPPORTED_CHAINS server-side, so a stale label here
// can't let an unsupported chain through.
const DESTINATION_CHAINS: { value: string; label: string }[] = [
  { value: "ARC_TESTNET", label: "Arc Testnet" },
  { value: "ETH_SEPOLIA", label: "Ethereum Sepolia" },
  { value: "BASE_SEPOLIA", label: "Base Sepolia" },
  { value: "ARBITRUM_SEPOLIA", label: "Arbitrum Sepolia" },
  { value: "HYPEREVM_TESTNET", label: "HyperEVM Testnet" },
];

export default function UnifiedSpendForm({
  buckets,
  disabled,
}: {
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [fromLedgerAccountId, setFromLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [toAddress, setToAddress] = useState("");
  const [destinationChain, setDestinationChain] = useState(DESTINATION_CHAINS[0].value);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  function handleReviewClick(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fromLedgerAccountId) {
      setError("Choose a bucket to spend from.");
      return;
    }
    if (!toAddress.trim()) {
      setError("Enter a destination address.");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setConfirming(true);
  }

  async function handleSend() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/unified-balance/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          fromLedgerAccountId,
          toAddress: toAddress.trim(),
          destinationChain,
          amount: amount.trim(),
          memo: memo.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Payment failed");
        setConfirming(false);
        return;
      }
      router.push("/wallet");
      router.refresh();
    } catch {
      setError("Payment failed. Please try again.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  const chainLabel = DESTINATION_CHAINS.find((c) => c.value === destinationChain)?.label ?? destinationChain;

  return (
    <form onSubmit={handleReviewClick} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="from" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          From
        </label>
        <select
          id="from"
          value={fromLedgerAccountId}
          onChange={(e) => setFromLedgerAccountId(e.target.value)}
          disabled={disabled || confirming}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} - {b.balance} USDC
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="destinationChain" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Destination chain
        </label>
        <select
          id="destinationChain"
          value={destinationChain}
          onChange={(e) => setDestinationChain(e.target.value)}
          disabled={disabled || confirming}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {DESTINATION_CHAINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="toAddress" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          To address
        </label>
        <input
          id="toAddress"
          type="text"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          disabled={disabled || confirming}
          placeholder="0x1234…"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base font-mono disabled:opacity-50"
        />
        <p className="mt-1.5 text-xs text-[#7C8CA6]">
          A raw address on the destination chain — not a Comparta username.
        </p>
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
          disabled={disabled || confirming}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="memo" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Memo <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={disabled || confirming}
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
      </div>

      {confirming && (
        <div className="rounded-xl border border-[#E5EEFF] p-5 space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#2A5CE6] text-center">
            Review before sending
          </p>
          <div className="flex items-center justify-center gap-1.5">
            <Image src="/usdc.png" alt="USDC" width={20} height={20} className="rounded-full" />
            <p className="text-2xl font-bold text-[#0B1E3F] tracking-tight">{amount || "0.00"}</p>
          </div>
          <p className="text-center text-sm text-[#0B1E3F]">
            to <span className="font-mono">{toAddress}</span> on{" "}
            <span className="font-semibold">{chainLabel}</span>
          </p>
          {memo.trim() && <p className="text-center text-xs text-[#7C8CA6]">Memo: {memo}</p>}
        </div>
      )}

      {!confirming ? (
        <button
          type="submit"
          disabled={disabled || submitting}
          className="btn-3d w-full"
          style={sendBtnStyle}
        >
          Review
        </button>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={submitting}
            className="flex-1 px-4 py-3 rounded-3xl border border-[#E5E9F2] text-sm font-semibold text-[#0B1E3F] bg-white hover:bg-[#F7F8FB] transition-colors disabled:opacity-50"
          >
            Recheck
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={submitting}
            className="btn-3d flex-1"
            style={sendBtnStyle}
          >
            {submitting ? "Sending…" : "Confirm & send"}
          </button>
        </div>
      )}
    </form>
  );
}

const sendBtnStyle = {
  "--btn-bg": "#2A5CE6",
  "--btn-bg-hover": "#2450d1",
  "--btn-edge": "#1A3FA8",
  "--btn-edge-hover": "#17358f",
  color: "#ffffff",
} as React.CSSProperties;
