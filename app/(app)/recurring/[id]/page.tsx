// app/(app)/recurring/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface Transfer {
  id: string;
  name: string | null;
  destinationIdentifier: string | null;
  destinationLedgerAccountId: string | null;
  amount: string;
  frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  nextExecutionDate: string;
  endDate: string | null;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "COMPLETED";
}

interface Execution {
  id: string;
  scheduledDate: string;
  executedAt: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED_INSUFFICIENT_FUNDS" | "FAILED_OTHER";
  failureReason: string | null;
}

const FREQUENCY_LABEL: Record<Transfer["frequency"], string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
};

export default function RecurringTransferDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function load() {
    setLoading(true);
    try {
      const [transferRes, executionsRes] = await Promise.all([
        fetch(`/api/dca/${params.id}`),
        fetch(`/api/dca/${params.id}/executions`),
      ]);
      if (!transferRes.ok) {
        setNotFound(true);
        return;
      }
      const transferData = await transferRes.json();
      setTransfer(transferData.recurringTransfer);
      setAmount(transferData.recurringTransfer.amount);
      setFrequency(transferData.recurringTransfer.frequency);
      setEndDate(transferData.recurringTransfer.endDate?.slice(0, 10) ?? "");

      if (executionsRes.ok) {
        const executionsData = await executionsRes.json();
        setExecutions(executionsData.executions ?? []);
      }
    } catch {
      setError("Failed to load recurring transfer");
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: "pause" | "resume" | "cancel") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/dca/${params.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      await load();
    } catch {
      setError("Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/dca/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amount.trim(),
          frequency,
          endDate: endDate ? new Date(endDate).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save changes");
        return;
      }
      setEditing(false);
      await load();
    } catch {
      setError("Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-[#7C8CA6]">Loading…</div>;
  if (notFound || !transfer) return <div className="text-sm text-[#7C8CA6]">Recurring transfer not found.</div>;

  const isEditable = transfer.status === "ACTIVE" || transfer.status === "PAUSED";

  return (
    <div className="max-w-2xl space-y-6">
      <button onClick={() => router.push("/recurring")} className="text-sm font-medium text-[#2A5CE6] hover:underline">
        ← Recurring transfers
      </button>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium text-[#7C8CA6] mb-1">
              {transfer.name ?? transfer.destinationIdentifier ?? "Internal transfer"}
            </p>
            <p className="text-2xl font-semibold text-[#0B1E3F] tabular-nums">{formatMoney(transfer.amount)}</p>
          </div>
          <StatusPill value={transfer.status} />
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[#7C8CA6] mb-1">Frequency</dt>
            <dd className="text-[#0B1E3F] font-medium">{FREQUENCY_LABEL[transfer.frequency]}</dd>
          </div>
          <div>
            <dt className="text-[#7C8CA6] mb-1">Next execution</dt>
            <dd className="text-[#0B1E3F] font-medium">{formatDate(transfer.nextExecutionDate)}</dd>
          </div>
          {transfer.destinationIdentifier && (
            <div className="col-span-2">
              <dt className="text-[#7C8CA6] mb-1">Recipient</dt>
              <dd className="text-[#0B1E3F] font-mono">{transfer.destinationIdentifier}</dd>
            </div>
          )}
          {transfer.endDate && (
            <div>
              <dt className="text-[#7C8CA6] mb-1">Ends</dt>
              <dd className="text-[#0B1E3F] font-medium">{formatDate(transfer.endDate)}</dd>
            </div>
          )}
        </dl>

        {canManage && isEditable && (
          <div className="pt-4 border-t border-[#F2F4F8] space-y-4">
            {!editing ? (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setEditing(true)} className="text-sm font-medium text-[#2A5CE6] hover:underline">
                  Edit
                </button>
                {transfer.status === "ACTIVE" && (
                  <button
                    onClick={() => handleAction("pause")}
                    disabled={busy}
                    className="btn-3d btn-3d--sm btn-3d--neutral"
                  >
                    Pause
                  </button>
                )}
                {transfer.status === "PAUSED" && (
                  <button
                    onClick={() => handleAction("resume")}
                    disabled={busy}
                    className="btn-3d btn-3d--sm"
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
                    Resume
                  </button>
                )}
                <button
                  onClick={() => handleAction("cancel")}
                  disabled={busy}
                  className="text-sm font-medium text-red-600 hover:underline ml-auto"
                >
                  Cancel permanently
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="amount" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
                      Amount (USDC)
                    </label>
                    <input
                      id="amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
                    />
                  </div>
                  <div>
                    <label htmlFor="frequency" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
                      Frequency
                    </label>
                    <select
                      id="frequency"
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
                    >
                      {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="endDate" className="block text-xs font-semibold text-[#0B1E3F] mb-1.5">
                    End date <span className="font-normal text-[#7C8CA6]">(optional)</span>
                  </label>
                  <input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="btn-3d btn-3d--sm"
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
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="btn-3d btn-3d--sm btn-3d--neutral">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[#0B1E3F] mb-3">Execution history</h2>
        {executions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-6 text-center text-sm text-[#7C8CA6]">
            No executions yet.
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
            {executions.map((ex) => (
              <div key={ex.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-[#0B1E3F]">Scheduled {formatDate(ex.scheduledDate)}</p>
                  {ex.failureReason && <p className="text-xs text-red-600 mt-0.5">{ex.failureReason}</p>}
                </div>
                <StatusPill value={ex.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}