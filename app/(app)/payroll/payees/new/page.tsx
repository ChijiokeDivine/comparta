// app/(app)/payroll/payees/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { KybBanner } from "../../../_components/Kyb";

const PAY_TYPES = ["SALARY", "HOURLY", "CONTRACT"] as const;

export default function NewPayeePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const kybStatus = session?.user?.kybStatus ?? "PENDING";
  const disabled = kybStatus !== "APPROVED";

  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [payType, setPayType] = useState<(typeof PAY_TYPES)[number]>("SALARY");
  const [defaultAmount, setDefaultAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !identifier.trim()) {
      setError("Name and identifier are both required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/payroll/payees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          identifier: identifier.trim(),
          payType,
          defaultAmount: defaultAmount.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create payee");
        return;
      }
      router.push("/payroll/payees");
      router.refresh();
    } catch {
      setError("Could not create payee");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <KybBanner status={kybStatus} />
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New payee</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor="identifier" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            @username or 0x address
          </label>
          <input
            id="identifier"
            value={identifier}
            onChange={(e) => {
              const val = e.target.value;
              setIdentifier(val.startsWith("@") ? val.slice(1) : val);
            }}
            disabled={disabled}
            placeholder="@jane or 0x1234…"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor="payType" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Pay type
          </label>
          <select
            id="payType"
            value={payType}
            onChange={(e) => setPayType(e.target.value as typeof payType)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          >
            {PAY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="defaultAmount" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Default amount <span className="font-normal text-[#7C8CA6]">(optional, USDC)</span>
          </label>
          <input
            id="defaultAmount"
            type="text"
            inputMode="decimal"
            value={defaultAmount}
            onChange={(e) => setDefaultAmount(e.target.value)}
            disabled={disabled}
            placeholder="0.00"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Notes <span className="font-normal text-[#7C8CA6]">(optional)</span>
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
            rows={3}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          />
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
          {submitting ? "Creating…" : "Add payee"}
        </button>
      </form>
    </div>
  );
}