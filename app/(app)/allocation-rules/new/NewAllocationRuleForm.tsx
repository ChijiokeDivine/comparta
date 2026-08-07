// app/(app)/allocation-rules/new/NewAllocationRuleForm.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
}

const RULE_TYPES = [
  {
    value: "PERCENTAGE",
    label: "Percentage",
    hint: "Allocate a % of every incoming amount - e.g. 20 = 20%",
  },
  {
    value: "FIXED_AMOUNT",
    label: "Fixed amount",
    hint: "Allocate a specific USDC amount every time - e.g. 150.00",
  },
] as const;

const TRIGGERS = [
  {
    value: "ON_INCOMING_PAYMENT",
    label: "On incoming payment",
    hint: "Run this rule automatically whenever funds land in the source bucket",
  },
  {
    value: "SCHEDULED",
    label: "Scheduled",
    hint: "Run on a recurring cron schedule (e.g. every Monday at 9am)",
  },
] as const;

export default function NewAllocationRuleForm({
  buckets,
  disabled,
}: {
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [ruleType, setRuleType] =
    useState<(typeof RULE_TYPES)[number]["value"]>("PERCENTAGE");
  const [trigger, setTrigger] =
    useState<(typeof TRIGGERS)[number]["value"]>("ON_INCOMING_PAYMENT");
  const [value, setValue] = useState("");
  const [scheduleCron, setScheduleCron] = useState("");
  const [priority, setPriority] = useState("");
  const [sourceLedgerAccountId, setSourceLedgerAccountId] = useState(
    buckets[0]?.id ?? ""
  );
  const [targetLedgerAccountId, setTargetLedgerAccountId] = useState(
    buckets[1]?.id ?? buckets[0]?.id ?? ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetBuckets = useMemo(
    () => buckets.filter((b) => b.id !== sourceLedgerAccountId),
    [buckets, sourceLedgerAccountId]
  );

  const selectedRuleType = RULE_TYPES.find((r) => r.value === ruleType)!;

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
      setError(
        ruleType === "PERCENTAGE"
          ? "Enter a percentage (e.g. 20 for 20%)."
          : "Enter a USDC amount (e.g. 150.00)."
      );
      return;
    }
    if (trigger === "SCHEDULED" && !scheduleCron.trim()) {
      setError("Scheduled rules require a cron expression.");
      return;
    }
    if (trigger === "ON_INCOMING_PAYMENT" && scheduleCron.trim()) {
      setError('Only "Scheduled" rules can have a cron schedule.');
      return;
    }
    if (priority.trim()) {
      const p = Number(priority);
      if (!Number.isInteger(p)) {
        setError("Priority must be a whole number.");
        return;
      }
    }

    const body: Record<string, unknown> = {
      sourceLedgerAccountId,
      targetLedgerAccountId,
      ruleType,
      value: value.trim(),
      trigger,
      name: name.trim() || undefined,
      scheduleCron:
        trigger === "SCHEDULED" ? scheduleCron.trim() || undefined : undefined,
      priority: priority.trim()
        ? Number.parseInt(priority.trim(), 10)
        : undefined,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/allocation-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create rule");
        return;
      }
      router.push("/allocation-rules");
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
        <div
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          Name <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled || submitting}
          maxLength={200}
          placeholder=""
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
        <p className="mt-1.5 text-xs text-[#7C8CA6]">
          If left blank, the rule will be auto-named from its value and target
          bucket.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="source"
            className="block text-sm font-semibold text-[#0B1E3F] mb-2"
          >
            From 
          </label>
          <select
            id="source"
            value={sourceLedgerAccountId}
            onChange={(e) => {
              const next = e.target.value;
              setSourceLedgerAccountId(next);
              if (targetLedgerAccountId === next && targetBuckets[0]) {
                setTargetLedgerAccountId(targetBuckets[0].id);
              } else if (targetLedgerAccountId === next) {
                setTargetLedgerAccountId("");
              }
            }}
            disabled={disabled || submitting}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          >
            <option value="" disabled>
              Select a bucket
            </option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="target"
            className="block text-sm font-semibold text-[#0B1E3F] mb-2"
          >
            To 
          </label>
          <select
            id="target"
            value={targetLedgerAccountId}
            onChange={(e) => setTargetLedgerAccountId(e.target.value)}
            disabled={disabled || submitting}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
          >
            <option value="" disabled>
              Select a bucket
            </option>
            {targetBuckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Rule type
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {RULE_TYPES.map((r) => (
            <div key={r.value} className="relative group">
              <button
                type="button"
                disabled={disabled || submitting}
                onClick={() => {
                  setRuleType(r.value);
                  setValue("");
                }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 cursor-help ${
                  ruleType === r.value
                    ? "border-[#2A5CE6] bg-[#EEF2FF]"
                    : "border-[#E5E9F2] hover:border-[#2A5CE6]"
                }`}
              >
                <p className="text-sm font-medium text-[#0B1E3F]">{r.label}</p>
              </button>
              <div className="pointer-events-none absolute z-10 left-1/2 -translate-x-1/2 top-full mt-2 w-64 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <div className="bg-white/90 backdrop-blur-md rounded-xl px-4 py-2.5 shadow-lg border border-[#E5E9F2]">
                  <p className="text-xs text-[#7C8CA6] leading-relaxed">{r.hint}</p>
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-3 h-3 rotate-45 bg-white/90 backdrop-blur-md border-l border-t border-[#E5E9F2]"></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="value"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          Value{" "}
          <span className="font-normal text-[#7C8CA6]">
            {ruleType === "PERCENTAGE" ? "(%, 0.01 – 100)" : "(USDC)"}
          </span>
        </label>
        <input
          id="value"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || submitting}
          
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
        {ruleType === "PERCENTAGE" && (
          <p className="mt-1.5 text-xs text-[#7C8CA6]">
            Active percentage rules from the same bucket and trigger can never
            add up to more than 100%.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Trigger
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TRIGGERS.map((t) => (
            <div key={t.value} className="relative group">
              <button
                type="button"
                disabled={disabled || submitting}
                onClick={() => {
                  setTrigger(t.value);
                  if (t.value !== "SCHEDULED") setScheduleCron("");
                }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 cursor-help ${
                  trigger === t.value
                    ? "border-[#2A5CE6] bg-[#EEF2FF]"
                    : "border-[#E5E9F2] hover:border-[#2A5CE6]"
                }`}
              >
                <p className="text-sm font-medium text-[#0B1E3F]">{t.label}</p>
              </button>
              <div className="pointer-events-none absolute z-10 left-1/2 -translate-x-1/2 top-full mt-2 w-64 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <div className="bg-white/90 backdrop-blur-md rounded-xl px-4 py-2.5 shadow-lg border border-[#E5E9F2]">
                  <p className="text-xs text-[#7C8CA6] leading-relaxed">{t.hint}</p>
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-3 h-3 rotate-45 bg-white/90 backdrop-blur-md border-l border-t border-[#E5E9F2]"></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {trigger === "SCHEDULED" && (
        <div>
          <label
            htmlFor="cron"
            className="block text-sm font-semibold text-[#0B1E3F] mb-2"
          >
            Schedule (cron expression)
          </label>
          <input
            id="cron"
            value={scheduleCron}
            onChange={(e) => setScheduleCron(e.target.value)}
            disabled={disabled || submitting}
            placeholder="0 9 * * 1  (every Monday at 9:00)"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm font-mono disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-[#7C8CA6]">
            5-field cron: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}

      <div>
        <label
          htmlFor="priority"
          className="block text-sm font-semibold text-[#0B1E3F] mb-2"
        >
          Priority <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="priority"
          type="number"
          step={1}
          min={0}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          disabled={disabled || submitting}
          placeholder="0"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
        <p className="mt-1.5 text-xs text-[#7C8CA6]">
          Lower numbers run first. Rules with the same priority execute in
          creation order.
        </p>
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
