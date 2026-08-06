// app/(app)/savings/rules/[id]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function EditSavingsRulePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const ruleId = params.id;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [trigger, setTrigger] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [scheduleCron, setScheduleCron] = useState("");
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/savings/rules/${ruleId}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setTrigger(data.savingsRule.trigger);
        setName(data.savingsRule.name ?? "");
        setValue(data.savingsRule.displayValue);
        setScheduleCron(data.savingsRule.scheduleCron ?? "");
        setActive(data.savingsRule.active);
      })
      .catch(() => setError("Failed to load rule"))
      .finally(() => setLoading(false));
  }, [ruleId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/savings/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: value.trim() || undefined,
          name: name.trim() || undefined,
          scheduleCron: scheduleCron.trim() || undefined,
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save changes");
        return;
      }
      router.push("/savings/rules");
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
      const res = await fetch(`/api/savings/rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        // The API blocks deleting a rule that's already fired at least
        // once (422) — the error message explains that; deactivating is
        // the intended path for those.
        setError(data.error ?? "Could not delete rule");
        return;
      }
      router.push("/savings/rules");
      router.refresh();
    } catch {
      setError("Could not delete rule");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) return <div className="max-w-lg text-sm text-[#7C8CA6]">Loading…</div>;
  if (notFound) return <div className="max-w-lg text-sm text-[#7C8CA6]">Rule not found.</div>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Edit auto-save rule</h1>

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
            maxLength={200}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
          />
        </div>

        <div>
          <label htmlFor="value" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            Value {trigger === "PERCENTAGE_OF_INCOME" ? "(%)" : "(USDC)"}
          </label>
          <input
            id="value"
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
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
              className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm font-mono"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-[#0B1E3F]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4" />
          Active
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
            Delete this rule
          </button>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm text-amber-800">
              Rules that have already run at least once can&apos;t be deleted — deactivate instead.
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
                {deleting ? "Removing…" : "Confirm delete"}
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