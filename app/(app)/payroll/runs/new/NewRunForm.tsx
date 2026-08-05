// app/(app)/payroll/runs/new/NewRunForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
}

interface Payee {
  id: string;
  name: string;
  identifier: string;
  payType: "SALARY" | "HOURLY" | "CONTRACT";
  defaultAmount: string | null;
}

export default function NewRunForm({
  buckets,
  payees,
  disabled,
}: {
  buckets: Bucket[];
  payees: Payee[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [sourceLedgerAccountId, setSourceLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(payees.map((p) => [p.id, p.defaultAmount ?? ""]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPayees = payees.filter((p) => selected[p.id]);
  const totalPreview = selectedPayees.reduce((sum, p) => sum + (Number(amounts[p.id]) || 0), 0);

  function toggle(payeeId: string) {
    setSelected((prev) => ({ ...prev, [payeeId]: !prev[payeeId] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sourceLedgerAccountId) {
      setError("Choose a bucket to pay from.");
      return;
    }
    if (selectedPayees.length === 0) {
      setError("Select at least one payee.");
      return;
    }
    if (selectedPayees.some((p) => !amounts[p.id]?.trim())) {
      setError("Every selected payee needs an amount.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLedgerAccountId,
          items: selectedPayees.map((p) => ({ payeeId: p.id, amount: amounts[p.id].trim() })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create payroll run");
        return;
      }
      router.push(`/payroll/runs/${data.run.id}`);
      router.refresh();
    } catch {
      setError("Could not create payroll run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="source" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Pay from
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
        <p className="text-sm font-semibold text-[#0B1E3F] mb-3">Payees</p>
        {payees.length === 0 ? (
          <p className="text-sm text-[#7C8CA6]">
            No active payees yet. Add one from the Payees tab first.
          </p>
        ) : (
          <div className="rounded-xl border border-[#E5E9F2] divide-y divide-[#F2F4F8]">
            {payees.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={!!selected[p.id]}
                  onChange={() => toggle(p.id)}
                  disabled={disabled}
                  className="w-4 h-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#0B1E3F] truncate">{p.name}</p>
                  <p className="text-xs text-[#7C8CA6] font-mono truncate">{p.identifier}</p>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amounts[p.id] ?? ""}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  disabled={disabled || !selected[p.id]}
                  placeholder="0.00"
                  className="w-28 px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6] disabled:opacity-50 shrink-0"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-[#F7F8FB] p-4 flex justify-between text-sm">
        <span className="text-[#3E4A6B]">Total (preview)</span>
        <span className="font-semibold text-[#0B1E3F] tabular-nums">{totalPreview.toFixed(2)} USDC</span>
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
        {submitting ? "Creating…" : "Create draft run"}
      </button>
    </form>
  );
}