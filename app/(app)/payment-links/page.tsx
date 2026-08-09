// app/(app)/payment-links/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/app/components/StatusPill";
import { formatDate, formatMoney } from "@/app/invoices/_components/format";
import Image from "next/image";

interface PaymentLink {
  id: string;
  slug: string;
  type: "FIXED_AMOUNT" | "OPEN_AMOUNT";
  amount: string | null;
  description: string | null;
  status: "ACTIVE" | "PAUSED" | "EXPIRED";
  useCount: number;
  maxUses: number | null;
  confirmedPaymentCount: number;
  createdAt: string;
}

const TABS = ["ALL", "ACTIVE", "PAUSED", "EXPIRED"] as const;

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = tab === "ALL" ? "" : `?status=${tab}`;
    fetch(`/api/payment-links${params}`)
      .then((res) => res.json())
      .then((data) => setLinks(data.paymentLinks ?? []))
      .catch(() => setError("Failed to load payment links"))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Payment links</h1>
        <Link
          href="/payment-links/new"
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
          New payment link
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
            {t === "ALL" ? "All" : t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && links.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6] flex flex-col items-center justify-center min-h-[300px]">
          No payment links yet.
          <div className="relative w-24 h-24 mt-4 flex items-center justify-center">
            <Image
                src="/money.png"
                alt="No payment links"
                fill
                className="object-contain"
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {links.map((link) => (
            <Link
              key={link.id}
              href={`/payment-links/${link.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0B1E3F] mb-4 truncate">
                  {link.description || `/pay/${link.slug}`}
                </p>
                <p className="text-xs text-[#7C8CA6]">
                  {link.confirmedPaymentCount} payment{link.confirmedPaymentCount === 1 ? "" : "s"} · created{" "}
                  {formatDate(link.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B1E3F] tabular-nums shrink-0">
                  <Image
                    src="/usdc.png"
                    alt="USDC"
                    width={15}
                    height={15}
                    className="rounded-full shrink-0"
                  />
                  {link.amount ? `${formatMoney(link.amount)}` : "Open amount"}
                </span>
                <StatusPill value={link.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}