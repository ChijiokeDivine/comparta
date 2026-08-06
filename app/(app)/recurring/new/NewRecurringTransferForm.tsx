// app/(app)/recurring/new/NewRecurringTransferForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
}

const FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
] as const;

export default function NewRecurringTransferForm({
  buckets,
  disabled,
}: {
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sourceLedgerAccountId, setSourceLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [destinationType, setDestinationType] = useState<"EXTERNAL" | "INTERNAL">("EXTERNAL");
  const [destinationIdentifier, setDestinationIdentifier] = useState("");
  const [destinationLedgerAccountId, setDestinationLedgerAccountId] = useState(
    buckets[1]?.id ?? buckets[0]?.id ?? ""
  );
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]["value"]>("MONTHLY");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sourceLedgerAccountId) {
      setError("Choose a bucket to send from.");
      return;
    }
    if (destinationType === "EXTERNAL" && !destinationIdentifier.trim()) {
      setError("Enter a recipient @username or 0x address.");
      return;
    }
    if (destinationType === "INTERNAL" && !destinationLedgerAccountId) {
      setError("Choose a destination bucket.");
      return;
    }
    if (destinationType === "INTERNAL" && destinationLedgerAccountId === sourceLedgerAccountId) {
      setError("Source and destination buckets must be different.");
      return;
    }
    if (!amount.trim() || !startDate) {
      setError("Amount and start date are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/dca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLedgerAccountId,
          ...(destinationType === "EXTERNAL"
            ? { destinationIdentifier: destinationIdentifier.trim() }
            : { destinationLedgerAccountId }),
          amount: amount.trim(),
          frequency,
          startDate: new Date(startDate).toISOString(),
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
          name: name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create recurring transfer");
        return;
      }
      router.push(`/recurring/${data.recurringTransfer.id}`);
      router.refresh();
    } catch {
      setError("Could not create recurring transfer");
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
        <label htmlFor="name" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Name <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          maxLength={200}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="source" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          From
        </label>
        <select
          id="source"
          value={sourceLedgerAccountId}
          onChange={(e) => setSourceLedgerAccountId(e.target.value)}
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

      <div>
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">Destination</label>
        <div className="flex gap-2 mb-3">
          {(["EXTERNAL", "INTERNAL"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => setDestinationType(t)}
              className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 ${
                destinationType === t
                  ? "border-[#2A5CE6] bg-[#EEF2FF] text-[#2A5CE6]"
                  : "border-[#E5E9F2] text-[#3E4A6B] hover:border-[#2A5CE6]"
              }`}
            >
              {t === "EXTERNAL" ? "@username or address" : "Another bucket"}
            </button>
          ))}
        </div>
        {destinationType === "EXTERNAL" ? (
          <input
            value={destinationIdentifier}
            onChange={(e) => setDestinationIdentifier(e.target.value)}
            disabled={disabled}
            placeholder="@acme or 0x1234…"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        ) : (
          <select
            value={destinationLedgerAccountId}
            onChange={(e) => setDestinationLedgerAccountId(e.target.value)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          >
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
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
          disabled={disabled}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="frequency" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Frequency
        </label>
        <select
          id="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="startDate" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Start date
          </label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            End date <span className="font-normal text-[#7C8CA6]">(optional)</span>
          </label>
          <input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
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
        {submitting ? "Creating…" : "Create recurring transfer"}
      </button>
    </form>
  );
}