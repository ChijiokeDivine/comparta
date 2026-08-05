// app/(app)/payment-links/new/NewPaymentLinkForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
}

export default function NewPaymentLinkForm({ buckets, disabled }: { buckets: Bucket[]; disabled: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<"FIXED_AMOUNT" | "OPEN_AMOUNT">("FIXED_AMOUNT");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [receivingLedgerAccountId, setReceivingLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!receivingLedgerAccountId) {
      setError("Choose a bucket to receive payments into.");
      return;
    }
    if (type === "FIXED_AMOUNT" && !amount.trim()) {
      setError("Enter an amount for a fixed-amount link.");
      return;
    }

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
        return;
      }
      router.push(`/payment-links/${data.paymentLink.id}`);
      router.refresh();
    } catch {
      setError("Could not create payment link");
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

      <div>
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">Amount type</label>
        <div className="flex gap-2">
          {(["FIXED_AMOUNT", "OPEN_AMOUNT"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => setType(t)}
              className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 ${
                type === t
                  ? "border-[#2A5CE6] bg-[#EEF2FF] text-[#2A5CE6]"
                  : "border-[#E5E9F2] text-[#3E4A6B] hover:border-[#2A5CE6]"
              }`}
            >
              {t === "FIXED_AMOUNT" ? "Fixed amount" : "Open amount"}
            </button>
          ))}
        </div>
      </div>

      {type === "FIXED_AMOUNT" && (
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
            disabled={disabled}
            placeholder="0.00"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>
      )}

      <div>
        <label htmlFor="description" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Description <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={disabled}
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="bucket" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Receiving bucket
        </label>
        <select
          id="bucket"
          value={receivingLedgerAccountId}
          onChange={(e) => setReceivingLedgerAccountId(e.target.value)}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        >
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="expiresAt" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Expires <span className="font-normal text-[#7C8CA6]">(optional)</span>
          </label>
          <input
            id="expiresAt"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="maxUses" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Max uses <span className="font-normal text-[#7C8CA6]">(optional)</span>
          </label>
          <input
            id="maxUses"
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled || submitting}
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
        {submitting ? "Creating…" : "Create payment link"}
      </button>
    </form>
  );
}