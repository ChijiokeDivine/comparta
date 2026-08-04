// app/(app)/buckets/new/NewBucketForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { value: "OPERATING", label: "Operating" },
  { value: "RESERVE", label: "Reserve" },
  { value: "PAYROLL", label: "Payroll" },
  { value: "SAVINGS", label: "Savings" },
  { value: "CUSTOM", label: "Custom" },
] as const;

export default function NewBucketForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("CUSTOM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give this bucket a name.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create bucket");
        return;
      }
      router.push(`/buckets/${data.bucket.id}`);
      router.refresh();
    } catch {
      setError("Could not create bucket");
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
        <label htmlFor="bucket-name" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Name
        </label>
        <input
          id="bucket-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          maxLength={100}
          placeholder="e.g. Marketing reserve"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="bucket-type" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Type
        </label>
        <select
          id="bucket-type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
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
        {submitting ? "Creating…" : "Create bucket"}
      </button>
    </form>
  );
}