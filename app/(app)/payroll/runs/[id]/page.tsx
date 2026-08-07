// app/(app)/payroll/runs/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface RunItem {
  id: string;
  amount: string;
  status: "PENDING" | "SENT" | "CONFIRMED" | "FAILED";
  identifierIssue: boolean;
  failureReason: string | null;
  payee?: { name: string; identifier: string };
}

interface Run {
  id: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalAmount: string;
  createdAt: string;
  items: RunItem[];
}

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Awaiting approval",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export default function PayrollRunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [run, setRun] = useState<Run | null>(null);
  const [sourceBucketName, setSourceBucketName] = useState("");
  const [sourceBucketBalance, setSourceBucketBalance] = useState("0");
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [shortfall, setShortfall] = useState<string | null>(null);
  const [unresolvedIdentifiers, setUnresolvedIdentifiers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryingItem, setRetryingItem] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/payroll/runs/${params.id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setRun(data.run);
      setSourceBucketName(data.sourceBucketName);
      setSourceBucketBalance(data.sourceBucketBalance);
      setInsufficientFunds(data.insufficientFunds);
      setShortfall(data.shortfall);
      setUnresolvedIdentifiers(data.unresolvedIdentifiers ?? []);
    } catch {
      setError("Failed to load payroll run");
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(url: string, method: "POST" | "DELETE") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(url, { method });
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

  async function handleRetryItem(itemId: string) {
    setError(null);
    setRetryingItem(itemId);
    try {
      const res = await fetch(`/api/payroll/runs/${params.id}/items/${itemId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Retry failed");
        return;
      }
      await load();
    } catch {
      setError("Retry failed");
    } finally {
      setRetryingItem(null);
    }
  }

  if (loading) return <div className="text-sm text-[#7C8CA6]">Loading…</div>;
  if (notFound || !run) return <div className="text-sm text-[#7C8CA6]">Payroll run not found.</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <button onClick={() => router.push("/payroll")} className="text-sm font-medium text-[#2A5CE6] hover:underline">
        ← Payroll
      </button>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium text-[#7C8CA6] mb-1">Run started {formatDate(run.createdAt)}</p>
            <p className="text-2xl font-semibold text-[#0B1E3F] tabular-nums">{formatMoney(run.totalAmount)}</p>
          </div>
          <StatusPill value={run.status} label={RUN_STATUS_LABEL[run.status]} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[#7C8CA6] mb-1">Source bucket</p>
            <p className="text-[#0B1E3F] font-medium">{sourceBucketName}</p>
          </div>
          <div>
            <p className="text-[#7C8CA6] mb-1">Bucket balance</p>
            <p className="text-[#0B1E3F] font-medium tabular-nums">{formatMoney(sourceBucketBalance)}</p>
          </div>
        </div>

        {insufficientFunds && shortfall && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Insufficient funds - short by {formatMoney(shortfall)}. Add funds to {sourceBucketName} before approving.
          </div>
        )}

        {unresolvedIdentifiers.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Some payee identifiers couldn&apos;t be resolved: {unresolvedIdentifiers.join(", ")}. Fix these payees
            before approving.
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-[#7C8CA6] mb-2">Payees</p>
          <div className="rounded-xl border border-[#E5E9F2] divide-y divide-[#F2F4F8]">
            {run.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#0B1E3F] truncate">
                    {item.payee?.name ?? "Unknown payee"}
                  </p>
                  <p className="text-xs text-[#7C8CA6] font-mono truncate">{item.payee?.identifier}</p>
                  {item.status === "FAILED" && item.failureReason && (
                    <p className="text-xs text-red-600 mt-0.5">{item.failureReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                    {formatMoney(item.amount)}
                  </span>
                  <StatusPill value={item.status} />
                  {item.status === "FAILED" && canManage && (
                    <button
                      onClick={() => handleRetryItem(item.id)}
                      disabled={retryingItem === item.id}
                      className="text-xs font-medium text-[#2A5CE6] hover:underline"
                    >
                      {retryingItem === item.id ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {canManage && run.status === "DRAFT" && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleAction(`/api/payroll/runs/${run.id}/submit`, "POST")}
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
              {busy ? "Submitting…" : "Submit for approval"}
            </button>
            <button
              onClick={() => handleAction(`/api/payroll/runs/${run.id}`, "DELETE")}
              disabled={busy}
              className="btn-3d btn-3d--sm btn-3d--neutral"
            >
              Delete draft
            </button>
          </div>
        )}

        {canManage && run.status === "PENDING_APPROVAL" && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleAction(`/api/payroll/runs/${run.id}/approve`, "POST")}
              disabled={busy || insufficientFunds || unresolvedIdentifiers.length > 0}
              className="btn-3d btn-3d--sm"
              style={
                {
                  "--btn-bg": "#059669",
                  "--btn-bg-hover": "#047857",
                  "--btn-edge": "#065f46",
                  "--btn-edge-hover": "#064e3b",
                  color: "#ffffff",
                } as React.CSSProperties
              }
            >
              {busy ? "Approving…" : "Approve & send"}
            </button>
            <button
              onClick={() => handleAction(`/api/payroll/runs/${run.id}/submit`, "DELETE")}
              disabled={busy}
              className="btn-3d btn-3d--sm btn-3d--neutral"
            >
              Return to draft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}