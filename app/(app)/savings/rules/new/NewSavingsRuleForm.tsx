// app/(app)/savings/rules/new/NewSavingsRuleForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
}

const TRIGGERS = [
  { value: "PERCENTAGE_OF_INCOME", label: "% of income", hint: "e.g. 10 = sweep 10% of every inflow" },
  { value: "ROUND_UP", label: "Round-up", hint: "e.g. 1.00 = round every transfer up to the nearest $1" },
  { value: "FIXED_RECURRING", label: "Fixed recurring", hint: "e.g. 50.00 = sweep $50 on schedule" },
] as const;

export default function NewSavingsRuleForm({ buckets, disabled }: { buckets: Bucket[]; disabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]["value"]>("PERCENTAGE_OF_INCOME");
  const [value, setValue] = useState("");
  const [scheduleCron, setScheduleCron] = useState("");
  const [sourceLedgerAccountId, setSourceLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [targetLedgerAccountId, setTargetLedgerAccountId] = useState(buckets[1]?.id ?? buckets[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTrigger = TRIGGERS.find((t) => t.value === trigger)!;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sourceLedgerAccountId || !targetLedgerAccountId) {
      setError("Choose both a source and a target bucket.");
      return;
    }
    if (sourceLedgerAccountId === targetLedgerAccountId) {
      setError("Source and target buckets must be different.");
      return;
    }
    if (!value.trim()) {
      setError("Enter a value for this rule.");
      return;
    }
    if (trigger === "FIXED_RECURRING" && !scheduleCron.trim()) {
      setError("Fixed recurring rules need a schedule (cron expression).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/savings/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLedgerAccountId,
          targetLedgerAccountId,
          trigger,
          value: value.trim(),
          scheduleCron: scheduleCron.trim() || undefined,
          name: name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create rule");
        return;
      }
      router.push("/savings/rules");
      router.refresh();
    } catch {
      setError("Could not create rule");
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
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">Trigger</label>
        <div className="grid grid-cols-1 gap-2">
          {TRIGGERS.map((t) => (
            <button
              key={t.value}
              type="button"
              disabled={disabled}
              onClick={() => setTrigger(t.value)}
              className={`text-left px-4 py-2.5 rounded-xl border transition-colors disabled:opacity-50 ${
                trigger === t.value
                  ? "border-[#2A5CE6] bg-[#EEF2FF]"
                  : "border-[#E5E9F2] hover:border-[#2A5CE6]"
              }`}
            >
              <p className="text-sm font-medium text-[#0B1E3F]">{t.label}</p>
              <p className="text-xs text-[#7C8CA6]">{t.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="value" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Value {selectedTrigger.value === "PERCENTAGE_OF_INCOME" ? "(%)" : "(USDC)"}
        </label>
        <input
          id="value"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          placeholder={selectedTrigger.value === "PERCENTAGE_OF_INCOME" ? "10" : "1.00"}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
      </div>

      {trigger === "FIXED_RECURRING" && (
        <div>
          <label htmlFor="cron" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Schedule (cron expression)
          </label>
          <input
            id="cron"
            value={scheduleCron}
            onChange={(e) => setScheduleCron(e.target.value)}
            disabled={disabled}
            placeholder="0 9 1 * *  (9am on the 1st of every month)"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm font-mono disabled:opacity-50"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
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
          <label htmlFor="target" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            To
          </label>
          <select
            id="target"
            value={targetLedgerAccountId}
            onChange={(e) => setTargetLedgerAccountId(e.target.value)}
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
        {submitting ? "Creating…" : "Create rule"}
      </button>
    </form>
  );
}