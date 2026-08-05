// app/(app)/payment-links/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface PaymentLink {
  id: string;
  slug: string;
  type: "FIXED_AMOUNT" | "OPEN_AMOUNT";
  amount: string | null;
  description: string | null;
  status: "ACTIVE" | "PAUSED" | "EXPIRED";
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  url: string;
  confirmedPaymentCount: number;
  totalCollected: string;
}

interface Payment {
  id: string;
  payerIdentifier: string;
  amountPaid: string | null;
  status: string;
  createdAt: string;
}

export default function PaymentLinkDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [link, setLink] = useState<PaymentLink | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/payment-links/${params.id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setLink(data.paymentLink);
      setPayments(data.payments ?? []);
    } catch {
      setError("Failed to load payment link");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    if (!link) return;
    setError(null);
    setToggling(true);
    try {
      const action = link.status === "ACTIVE" ? "pause" : "resume";
      const res = await fetch(`/api/payment-links/${params.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update payment link");
        return;
      }
      await load();
    } catch {
      setError("Could not update payment link");
    } finally {
      setToggling(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link.url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — non-critical, no-op
    }
  }

  if (loading) return <div className="text-sm text-[#7C8CA6]">Loading…</div>;
  if (notFound || !link) return <div className="text-sm text-[#7C8CA6]">Payment link not found.</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <button onClick={() => router.push("/payment-links")} className="text-sm font-medium text-[#2A5CE6] hover:underline">
        ← Payment links
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
              {link.description || "Payment link"}
            </p>
            <p className="text-2xl font-semibold text-[#0B1E3F] tabular-nums">
              {link.amount ? formatMoney(link.amount) : "Open amount"}
            </p>
          </div>
          <StatusPill value={link.status} />
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#E5E9F2] bg-[#F7F8FB] px-4 py-3">
          <span className="text-sm font-mono text-[#0B1E3F] truncate flex-1">{link.url}</span>
          <button onClick={handleCopy} className="btn-3d btn-3d--sm btn-3d--neutral shrink-0">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-[#7C8CA6] mb-1">Payments</dt>
            <dd className="text-[#0B1E3F] font-medium">{link.confirmedPaymentCount}</dd>
          </div>
          <div>
            <dt className="text-[#7C8CA6] mb-1">Collected</dt>
            <dd className="text-[#0B1E3F] font-medium tabular-nums">{formatMoney(link.totalCollected)}</dd>
          </div>
          <div>
            <dt className="text-[#7C8CA6] mb-1">Uses</dt>
            <dd className="text-[#0B1E3F] font-medium">
              {link.useCount}
              {link.maxUses ? ` / ${link.maxUses}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[#7C8CA6] mb-1">Expires</dt>
            <dd className="text-[#0B1E3F] font-medium">{link.expiresAt ? formatDate(link.expiresAt) : "Never"}</dd>
          </div>
        </dl>

        {link.status !== "EXPIRED" && (
          <button onClick={handleToggle} disabled={toggling} className="btn-3d btn-3d--sm btn-3d--neutral">
            {toggling ? "Updating…" : link.status === "ACTIVE" ? "Pause link" : "Resume link"}
          </button>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[#0B1E3F] mb-3">Payments</h2>
        {payments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-6 text-center text-sm text-[#7C8CA6]">
            No payments yet.
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-[#0B1E3F]">{p.payerIdentifier}</p>
                  <p className="text-xs text-[#7C8CA6]">{formatDate(p.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                    {p.amountPaid ? formatMoney(p.amountPaid) : "—"}
                  </span>
                  <StatusPill value={p.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}