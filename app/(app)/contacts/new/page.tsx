// app/(app)/contacts/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewContactPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim() || !identifier.trim()) {
      setError("Name and identifier are both required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          identifier: identifier.trim(),
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create contact");
        return;
      }
      router.push("/contacts");
      router.refresh();
    } catch {
      setError("Could not create contact");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New contact</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="displayName" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Name
          </label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base"
          />
        </div>

        <div>
          <label htmlFor="identifier" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            @username or 0x address
          </label>
          <input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="@acme or 0x1234…"
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base"
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
            rows={3}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
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
          {submitting ? "Saving…" : "Add contact"}
        </button>
      </form>
    </div>
  );
}