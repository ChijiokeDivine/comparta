// app/(app)/wallet/transfers/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface Transaction {
  id: string;
  direction: "IN" | "OUT";
  status: "PENDING" | "CONFIRMED" | "FAILED";
  amount: string;
  counterpartyAddress: string;
  createdAt: string;
}

const STATUS_OPTIONS = ["ALL", "PENDING", "CONFIRMED", "FAILED"] as const;
const DIRECTION_OPTIONS = ["ALL", "IN", "OUT"] as const;

export default function TransfersListPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [direction, setDirection] = useState<(typeof DIRECTION_OPTIONS)[number]>("ALL");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
  const [counterparty, setCounterparty] = useState("");

  const fetchPage = useCallback(
    async (cursor: string | null, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "25" });
        if (direction !== "ALL") params.set("direction", direction);
        if (counterparty.trim()) params.set("counterparty", counterparty.trim());
        if (cursor) params.set("cursor", cursor);

        const res = await fetch(`/api/transfers?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to load transfers");
          return;
        }
        setTransactions((prev) => (replace ? data.transactions : [...prev, ...data.transactions]));
        setNextCursor(data.nextCursor);
      } catch {
        setError("Failed to load transfers");
      } finally {
        setLoading(false);
      }
    },
    [direction, counterparty]
  );

  useEffect(() => {
    fetchPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, counterparty]);

  // Status has no server-side filter param on GET /api/transfers today -
  // filtered client-side over whatever page(s) have been loaded so far.
  const visible = status === "ALL" ? transactions : transactions.filter((t) => t.status === status);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Transfers</h1>
        <Link
          href="/wallet/transfer"
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
          New transfer
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as typeof direction)}
          className="px-3 py-2 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F]"
        >
          {DIRECTION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === "ALL" ? "All directions" : d === "IN" ? "Received" : "Sent"}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="px-3 py-2 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="Search counterparty address"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {visible.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No transfers found.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {visible.map((tx) => (
            <Link
              key={tx.id}
              href={`/wallet/transfers/${tx.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0B1E3F] truncate">
                  {tx.direction === "IN" ? "Received from" : "Sent to"}{" "}
                  <span className="font-mono text-xs text-[#7C8CA6]">
                    {tx.counterpartyAddress.slice(0, 8)}…{tx.counterpartyAddress.slice(-4)}
                  </span>
                </p>
                <p className="text-xs text-[#7C8CA6]">{formatDate(tx.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                  {formatMoney(tx.amount)}
                </span>
                <StatusPill value={tx.status} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="text-center">
          <button
            onClick={() => fetchPage(nextCursor, false)}
            disabled={loading}
            className="btn-3d btn-3d--sm btn-3d--neutral"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}