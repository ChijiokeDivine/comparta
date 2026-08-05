// app/(app)/payroll/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { StatusPill } from "@/app/components/StatusPill";
import PayrollSubNav from "./_components/PayrollSubNav";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface Run {
  id: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalAmount: string;
  createdAt: string;
  items?: { id: string }[];
}

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Awaiting approval",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export default function PayrollRunsPage() {
  const { data: session } = useSession();
  const canManage = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/payroll/runs")
      .then((res) => res.json())
      .then((data) => setRuns(data.runs ?? []))
      .catch(() => setError("Failed to load payroll runs"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Payroll</h1>
        {canManage && (
          <Link
            href="/payroll/runs/new"
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
            New run
          </Link>
        )}
      </div>

      <PayrollSubNav active="runs" />

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No payroll runs yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/payroll/runs/${run.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-[#0B1E3F]">Run started {formatDate(run.createdAt)}</p>
                {run.items && (
                  <p className="text-xs text-[#7C8CA6]">
                    {run.items.length} payee{run.items.length === 1 ? "" : "s"}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                  {formatMoney(run.totalAmount)}
                </span>
                <StatusPill value={run.status} label={RUN_STATUS_LABEL[run.status]} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}