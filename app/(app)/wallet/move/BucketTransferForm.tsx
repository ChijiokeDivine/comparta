// app/(app)/wallet/move/BucketTransferForm.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

export default function BucketTransferForm({
  buckets,
  disabled,
  initialFrom,
  initialTo,
}: {
  buckets: Bucket[];
  disabled: boolean;
  initialFrom?: string;
  initialTo?: string;
}) {
  const router = useRouter();

  const defaultFrom =
    buckets.find((b) => b.id === initialFrom)?.id ?? buckets[0]?.id ?? "";
  const defaultTo =
    buckets.find(
      (b) => b.id === initialTo && b.id !== defaultFrom
    )?.id ??
    buckets.find((b) => b.id !== defaultFrom)?.id ??
    "";

  const [fromLedgerAccountId, setFromLedgerAccountId] = useState(defaultFrom);
  const [toLedgerAccountId, setToLedgerAccountId] = useState(defaultTo);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceBucket = useMemo(
    () => buckets.find((b) => b.id === fromLedgerAccountId) ?? null,
    [buckets, fromLedgerAccountId]
  );
  const targetOptions = useMemo(
    () => buckets.filter((b) => b.id !== fromLedgerAccountId),
    [buckets, fromLedgerAccountId]
  );

  function setMaxAmount() {
    if (!sourceBucket) return;
    setAmount(sourceBucket.balance);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fromLedgerAccountId) {
      setError("Choose a source bucket.");
      return;
    }
    if (!toLedgerAccountId) {
      setError("Choose a destination bucket.");
      return;
    }
    if (fromLedgerAccountId === toLedgerAccountId) {
      setError("Source and destination buckets must be different.");
      return;
    }
    const trimmed = amount.trim();
    if (!trimmed) {
      setError("Enter an amount to move.");
      return;
    }
    const asNum = Number(trimmed);
    if (!Number.isFinite(asNum) || asNum <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/ledger/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromLedgerAccountId,
          toLedgerAccountId,
          amount: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Move failed");
        return;
      }
      router.push("/wallet");
      router.refresh();
    } catch {
      setError("Move failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="from-bucket"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          From
        </label>
        <select
          id="from-bucket"
          value={fromLedgerAccountId}
          onChange={(e) => {
            const newFrom = e.target.value;
            setFromLedgerAccountId(newFrom);
            if (newFrom === toLedgerAccountId) {
              const fallback = buckets.find((b) => b.id !== newFrom)?.id ?? "";
              setToLedgerAccountId(fallback);
            }
          }}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} — {b.balance} USDC
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="to-bucket"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          To
        </label>
        <select
          id="to-bucket"
          value={toLedgerAccountId}
          onChange={(e) => setToLedgerAccountId(e.target.value)}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {targetOptions.length === 0 && (
            <option value="" disabled>
              No other buckets available
            </option>
          )}
          {targetOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} — {b.balance} USDC
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label
            htmlFor="amount"
            className="block text-sm font-semibold text-[#0B1E3F]"
          >
            Amount (USDC)
          </label>
          {sourceBucket && (
            <button
              type="button"
              onClick={setMaxAmount}
              disabled={disabled}
              className="text-xs font-semibold text-[#2A5CE6] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use max ({sourceBucket.balance})
            </button>
          )}
        </div>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={disabled || submitting || buckets.length < 2}
        className="btn-3d w-full"
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
        {submitting ? "Moving…" : "Move funds"}
      </button>

      {buckets.length < 2 && (
        <p className="text-xs text-[#7C8CA6] text-center">
          Create at least two buckets to move funds between them.
        </p>
      )}
    </form>
  );
}
