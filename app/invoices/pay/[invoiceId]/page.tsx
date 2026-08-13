// app/invoices/pay/[invoiceId]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  STATUS_LABEL,
  STATUS_CLASSES,
  formatUSDC,
  formatDate,
  type InvoiceStatus,
} from "@/app/invoices/_components/format";
import Image from "next/image";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

interface PublicInvoice {
  id: string;
  orgLegalName: string;
  recipientIdentifier: string;
  lineItems: LineItem[];
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
  payToAddress: string | null;
}

const POLL_INTERVAL_MS = 8000;
const PAYABLE_STATUSES: InvoiceStatus[] = ["SENT", "VIEWED", "OVERDUE"];

export default function PayInvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invoices/public/${params.invoiceId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) setInvoice(data.invoice);
      })
      .catch(() => {
        // ignore transient error on mount
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.invoiceId]);

  // Payment confirmation isn't something this page drives — it's written
  // asynchronously by the existing background reconciliation in
  // lib/invoices/reconciliation.ts once it sees a matching inbound
  // transfer. Polling is just how this page notices that happened
  // without asking the payer to hit refresh themselves.
  useEffect(() => {
    if (!invoice || !PAYABLE_STATUSES.includes(invoice.status)) return;
    const id = setInterval(() => {
      fetch(`/api/invoices/public/${params.invoiceId}`)
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json();
          setInvoice(data.invoice);
        })
        .catch(() => {
          // transient network hiccup during a background poll — leave the
          // last good state on screen rather than flashing an error
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [invoice, params.invoiceId]);

  async function handleCopy() {
    if (!invoice?.payToAddress) return;
    try {
      await navigator.clipboard.writeText(invoice.payToAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — non-critical, no-op
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F8FB] flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-6">
          <Image src="/img5.png" alt="Comparta" height={28} width={100} />
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#7C8CA6]">Loading…</p>
        ) : notFound || !invoice ? (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-8 text-center">
            <p className="text-sm text-[#7C8CA6]">This invoice doesn&apos;t exist or hasn&apos;t been sent yet.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 sm:p-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#7C8CA6] mb-1">Invoice from</p>
                <p className="text-lg font-semibold text-[#0B1E3F]">{invoice.orgLegalName}</p>
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold shrink-0 ${STATUS_CLASSES[invoice.status]}`}
              >
                {STATUS_LABEL[invoice.status]}
              </span>
            </div>

            <div>
              <p className="text-3xl font-semibold text-[#0B1E3F] tabular-nums">
                {formatUSDC(invoice.total)}
              </p>
              <p className="text-sm text-[#7C8CA6] mt-1">
                {invoice.status === "PAID" && invoice.paidAt
                  ? `Paid ${formatDate(invoice.paidAt)}`
                  : `Due ${formatDate(invoice.dueDate)}`}
              </p>
            </div>

            <div className="rounded-xl border border-[#E5E9F2] divide-y divide-[#F2F4F8]">
              {invoice.lineItems.map((li, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <p className="text-[#0B1E3F]">{li.description}</p>
                    <p className="text-xs text-[#7C8CA6]">
                      {li.quantity} × {formatUSDC(li.unitPrice)}
                    </p>
                  </div>
                  <p className="text-[#0B1E3F] font-medium tabular-nums">
                    {formatUSDC((Number(li.quantity) * Number(li.unitPrice)).toFixed(2))}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-[#F7F8FB] p-4 space-y-1 text-sm">
              <div className="flex justify-between text-[#3E4A6B]">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatUSDC(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-[#3E4A6B]">
                <span>Tax</span>
                <span className="tabular-nums">{formatUSDC(invoice.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold text-[#0B1E3F] pt-1 border-t border-[#E5E9F2]">
                <span>Total</span>
                <span className="tabular-nums">{formatUSDC(invoice.total)}</span>
              </div>
            </div>

            {invoice.status === "PAID" && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 text-center">
                This invoice has been paid. Thank you!
              </div>
            )}

            {invoice.status === "VOID" && (
              <div className="rounded-xl border border-[#E5E9F2] bg-[#F7F8FB] p-4 text-sm text-[#7C8CA6] text-center">
                This invoice has been voided and is no longer payable.
              </div>
            )}

            {PAYABLE_STATUSES.includes(invoice.status) && (
              <div className="pt-2 border-t border-[#F2F4F8] space-y-3">
                <p className="text-sm font-semibold text-[#0B1E3F]">Pay with USDC</p>
                {invoice.payToAddress ? (
                  <>
                    <div className="flex items-center gap-2 rounded-xl border border-[#E5E9F2] bg-[#F7F8FB] px-4 py-3">
                      <span className="text-sm font-mono text-[#0B1E3F] truncate flex-1">
                        {invoice.payToAddress}
                      </span>
                      <button onClick={handleCopy} className="btn-3d btn-3d--sm btn-3d--neutral shrink-0">
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="text-xs text-[#7C8CA6]">
                      Send exactly {formatUSDC(invoice.total)} to the address above. This page
                      updates automatically once payment is received — no need to refresh.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[#7C8CA6]">
                    This merchant hasn&apos;t finished setting up payments yet. Check back soon.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}