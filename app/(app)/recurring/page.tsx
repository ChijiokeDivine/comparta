// app/(app)/recurring/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";
import Image from "next/image"
interface RecurringTransfer {
  id: string;
  name: string | null;
  destinationIdentifier: string | null;
  destinationLedgerAccountId: string | null;
  amount: string;
  frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  nextExecutionDate: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "COMPLETED";
}

const TABS = ["ALL", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;
const FREQUENCY_LABEL: Record<RecurringTransfer["frequency"], string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
};

export default function RecurringTransfersPage() {
  const { data: session } = useSession();
  const canManage = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [transfers, setTransfers] = useState<RecurringTransfer[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = tab === "ALL" ? "" : `?status=${tab}`;
    fetch(`/api/dca${params}`)
      .then((res) => res.json())
      .then((data) => setTransfers(data.recurringTransfers ?? []))
      .catch(() => setError("Failed to load recurring transfers"))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Recurring transfers</h1>
        {canManage && (
          <Link
            href="/recurring/new"
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
            New recurring transfer
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              tab === t
                ? "bg-[#0B1E3F] text-white border-[#0B1E3F]"
                : "bg-white text-[#3E4A6B] border-[#E5E9F2] hover:border-[#2A5CE6]"
            }`}
          >
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && transfers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6] flex flex-col items-center justify-center h-[220px]">
          No recurring transfers yet.

          <div className="flex items-center justify-center mt-5">
            <Image
              src="/allocation.webp"
              alt="USDC"
              width={50}
              height={50}
              className=" rounded-full"
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {transfers.map((t) => (
            <Link
              key={t.id}
              href={`/recurring/${t.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0B1E3F] truncate">
                  {t.name ?? t.destinationIdentifier ?? "Internal transfer"}
                </p>
                <p className="text-xs text-[#7C8CA6]">
                  {FREQUENCY_LABEL[t.frequency]} · next {formatDate(t.nextExecutionDate)}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">{formatMoney(t.amount)}</span>
                <StatusPill value={t.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}