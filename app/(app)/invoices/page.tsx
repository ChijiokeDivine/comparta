// app/(app)/invoices/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STATUS_LABEL, STATUS_CLASSES, formatUSDC, formatDate, type InvoiceStatus } from "@/app/invoices/_components/format";
import Image from "next/image";

interface Invoice {
  id: string;
  recipientIdentifier: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
}

const TABS: (InvoiceStatus | "ALL")[] = ["ALL", "DRAFT", "SENT", "VIEWED", "PAID", "OVERDUE", "VOID"];

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = tab === "ALL" ? "" : `?status=${tab}`;
    fetch(`/api/invoices${params}`)
      .then((res) => res.json())
      .then((data) => setInvoices(data.invoices ?? []))
      .catch(() => setError("Failed to load invoices"))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Invoices</h1>
        <Link
          href="/invoices/new"
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
          New invoice
        </Link>
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
            {t === "ALL" ? "All" : STATUS_LABEL[t]}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && invoices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6] flex flex-col items-center justify-center min-h-[300px]">
          No invoices {tab !== "ALL" ? `with status "${STATUS_LABEL[tab as InvoiceStatus]}"` : "yet"}.
           <div className="relative w-24 h-24 mt-4 flex items-center justify-center">
                <Image
                    src="/invoice.webp"
                    alt="No activity"
                    fill
                    className="object-contain"
                />
            </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/invoices/${inv.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0B1E3F] truncate">{inv.recipientIdentifier}</p>
                <p className="text-xs text-[#7C8CA6]">Due {formatDate(inv.dueDate)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                  {formatUSDC(inv.total)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[inv.status]}`}
                >
                  {STATUS_LABEL[inv.status]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}