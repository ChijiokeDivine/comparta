// app/(app)/payroll/payees/[id]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const PAY_TYPES = ["SALARY", "HOURLY", "CONTRACT"] as const;

export default function EditPayeePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const payeeId = params.id;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [payType, setPayType] = useState<(typeof PAY_TYPES)[number]>("SALARY");
  const [defaultAmount, setDefaultAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/payroll/payees/${payeeId}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setName(data.payee.name);
        setIdentifier(data.payee.identifier);
        setPayType(data.payee.payType);
        setDefaultAmount(data.payee.defaultAmount ?? "");
        setNotes(data.payee.notes ?? "");
        setActive(data.payee.active);
      })
      .catch(() => setError("Failed to load payee"))
      .finally(() => setLoading(false));
  }, [payeeId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/payroll/payees/${payeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          identifier: identifier.trim(),
          payType,
          defaultAmount: defaultAmount.trim() || null,
          notes: notes.trim() || null,
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save changes");
        return;
      }
      router.push("/payroll/payees");
      router.refresh();
    } catch {
      setError("Could not save changes");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/payroll/payees/${payeeId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        // The API deactivates instead of deleting if the payee has been used
        // in a run — surface that message rather than a generic failure.
        setError(data.error ?? "Could not delete payee");
        return;
      }
      router.push("/payroll/payees");
      router.refresh();
    } catch {
      setError("Could not delete payee");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) return <div className="max-w-lg text-sm text-[#7C8CA6]">Loading…</div>;
  if (notFound) return <div className="max-w-lg text-sm text-[#7C8CA6]">Payee not found.</div>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Edit payee</h1>

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
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
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
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
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
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
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
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
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
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-[#0B1E3F]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4" />
          Active (eligible for future payroll runs)
        </label>

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
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="pt-4 border-t border-[#F2F4F8]">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-red-600 hover:underline">
            Delete this payee
          </button>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm text-amber-800">
              If this payee has been used in a payroll run, they&apos;ll be deactivated instead of deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn-3d btn-3d--sm"
                style={
                  {
                    "--btn-bg": "#DC2626",
                    "--btn-bg-hover": "#c81e1e",
                    "--btn-edge": "#991b1b",
                    "--btn-edge-hover": "#7f1d1d",
                    color: "#ffffff",
                  } as React.CSSProperties
                }
              >
                {deleting ? "Removing…" : "Confirm"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn-3d btn-3d--sm btn-3d--neutral">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}