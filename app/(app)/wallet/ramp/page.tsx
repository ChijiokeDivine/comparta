// app/(app)/wallet/ramp/page.tsx
//
// Bank transfer history: every Paj onramp/offramp order for the org. Polls
// the server while an order is still INIT/PROCESSING so a missed webhook
// never leaves the list stale.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  Landmark,
} from "lucide-react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatDate } from "@/app/invoices/_components/format";
import { formatNaira, maskAccountNumber } from "@/lib/config/pajChains";

interface Order {
  id: string;
  type: "ONRAMP" | "OFFRAMP";
  status: "INIT" | "PROCESSING" | "COMPLETED" | "ERROR";
  chain: string;
  tokenAmount: string | null;
  fiatAmount: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  failureReason: string | null;
  createdAt: string;
}

type Filter = "ALL" | "ONRAMP" | "OFFRAMP";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ONRAMP", label: "Deposits" },
  { value: "OFFRAMP", label: "Payouts" },
];

const STATUS_TONE: Record<Order["status"], string> = {
  INIT: "bg-amber-50 text-amber-700 border-amber-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
};

export default function BankTransfersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pure fetch helper: no state updates here, so effects below never call
  // setState synchronously (react-hooks/set-state-in-effect).
  const fetchOrders = useCallback(async (activeFilter: Filter) => {
    const params = new URLSearchParams({ sync: "1" });
    if (activeFilter !== "ALL") params.set("type", activeFilter);
    const res = await fetch(`/api/paj/orders?${params.toString()}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return { ok: res.ok, data };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOrders(filter)
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data.error ?? "Couldn't load bank transfers.");
          return;
        }
        setOrders(data.orders ?? []);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load bank transfers.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, fetchOrders]);

  const hasActive = orders.some(
    (order) => order.status === "INIT" || order.status === "PROCESSING"
  );

  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      fetchOrders(filter)
        .then(({ ok, data }) => {
          if (ok) setOrders(data.orders ?? []);
        })
        .catch(() => {
          // Transient - the next tick retries.
        });
    }, 8000);
    return () => clearInterval(timer);
  }, [hasActive, filter, fetchOrders]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Bank transfers</h1>
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

      <div className="flex gap-1.5 rounded-full bg-[#FAF9F6] p-1 w-fit">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setFilter(option.value);
              setLoading(true);
              setError(null);
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              filter === option.value
                ? "bg-[#2A5CE6] text-white"
                : "text-[#3E4A6B] hover:bg-white"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#E5E9F2] bg-white py-16 text-sm text-[#7C8CA6]">
          <Loader2 size={16} className="animate-spin" /> Loading bank transfers…
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-10 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#7C8CA6]">
            <Landmark size={20} />
          </div>
          <p className="text-sm font-medium text-[#0B1E3F]">
            No bank transfers yet
          </p>
          <p className="mt-1 text-xs text-[#7C8CA6]">
            Add funds from your bank or send USDC to a Nigerian bank account.
          </p>
          <Link
            href="/wallet"
            className="mt-4 inline-block text-xs font-semibold text-[#2A5CE6] hover:underline"
          >
            Go to wallet →
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {orders.map((order) => {
            const isOnramp = order.type === "ONRAMP";
            return (
              <div
                key={order.id}
                className="flex items-start justify-between gap-4 px-5 py-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      isOnramp
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-[#F7FAFF] text-[#2A5CE6]"
                    }`}
                  >
                    {isOnramp ? (
                      <ArrowDownLeft size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0B1E3F]">
                      {isOnramp ? "Bank deposit" : "Bank payout"}
                    </p>
                    <p className="truncate text-xs text-[#7C8CA6]">
                      {order.bankName ?? "Nigerian bank"}
                      {order.accountNumber
                        ? ` · ${
                            order.type === "OFFRAMP"
                              ? maskAccountNumber(order.accountNumber)
                              : order.accountNumber
                          }`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#7C8CA6]">
                      {formatDate(order.createdAt)}
                    </p>
                    {order.status === "ERROR" && order.failureReason && (
                      <p className="mt-1 text-[11px] font-medium text-red-600">
                        {order.failureReason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B1E3F] tabular-nums">
                    <Image
                      src="/usdc.png"
                      alt="USDC"
                      width={13}
                      height={13}
                      className="rounded-full"
                    />
                    {order.tokenAmount
                      ? `${isOnramp ? "+" : "−"}${order.tokenAmount}`
                      : "—"}
                  </span>
                  <span className="text-[11px] text-[#7C8CA6] tabular-nums">
                    {formatNaira(order.fiatAmount)}
                  </span>
                  <StatusPill value={order.status} label={statusLabel(order.status)} />
                  <span
                    className={`md:hidden inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[order.status]}`}
                  >
                    {statusLabel(order.status)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusLabel(status: Order["status"]): string {
  switch (status) {
    case "INIT":
      return "Waiting";
    case "PROCESSING":
      return "Processing";
    case "COMPLETED":
      return "Complete";
    case "ERROR":
      return "Failed";
  }
}
