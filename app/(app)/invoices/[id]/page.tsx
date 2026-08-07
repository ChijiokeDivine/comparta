// app/(app)/invoices/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  STATUS_LABEL,
  STATUS_CLASSES,
  EVENT_LABEL,
  formatMoney,
  formatDate,
  type InvoiceStatus,
} from "@/app/invoices/_components/format";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

interface InvoiceEvent {
  id: string;
  eventType: keyof typeof EVENT_LABEL | string;
  createdAt: string;
}

interface Invoice {
  id: string;
  recipientIdentifier: string;
  recipientEmail: string | null;
  lineItems: LineItem[];
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  events: InvoiceEvent[];
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const kybApproved = session?.user?.kybStatus === "APPROVED";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setInvoice(data.invoice);
    } catch {
      setActionError("Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    setActionError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Could not send invoice");
        return;
      }
      await load();
    } catch {
      setActionError("Could not send invoice");
    } finally {
      setSending(false);
    }
  }

  async function handleVoid() {
    setActionError(null);
    setVoiding(true);
    try {
      const res = await fetch(`/api/invoices/${params.id}/void`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Could not void invoice");
        return;
      }
      await load();
    } catch {
      setActionError("Could not void invoice");
    } finally {
      setVoiding(false);
      setConfirmVoid(false);
    }
  }

  if (loading) return <div className="text-sm text-[#7C8CA6]">Loading…</div>;
  if (notFound || !invoice) return <div className="text-sm text-[#7C8CA6]">Invoice not found.</div>;

  const canSend = invoice.status === "DRAFT" && kybApproved;
  const canVoid = invoice.status !== "PAID" && invoice.status !== "VOID";

  return (
    <div className="max-w-2xl space-y-6">
      <button onClick={() => router.push("/invoices")} className="text-sm font-medium text-[#2A5CE6] hover:underline">
        ← Invoices
      </button>

      {actionError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {actionError}
        </div>
      )}

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium text-[#7C8CA6] mb-1">Billed to</p>
            <p className="text-lg font-semibold text-[#0B1E3F]">{invoice.recipientIdentifier}</p>
            {invoice.recipientEmail && <p className="text-sm text-[#7C8CA6]">{invoice.recipientEmail}</p>}
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[invoice.status]}`}
          >
            {STATUS_LABEL[invoice.status]}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[#7C8CA6] mb-1">Due date</p>
            <p className="text-[#0B1E3F] font-medium">{formatDate(invoice.dueDate)}</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-[#7C8CA6] mb-2">Line items</p>
          <div className="rounded-xl border border-[#E5E9F2] divide-y divide-[#F2F4F8]">
            {invoice.lineItems.map((li, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <p className="text-[#0B1E3F]">{li.description}</p>
                  <p className="text-xs text-[#7C8CA6]">
                    {li.quantity} × {formatMoney(li.unitPrice)}
                  </p>
                </div>
                <p className="text-[#0B1E3F] font-medium tabular-nums">
                  {formatMoney((Number(li.quantity) * Number(li.unitPrice)).toFixed(2))}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[#F7F8FB] p-4 space-y-1 text-sm">
          <div className="flex justify-between text-[#3E4A6B]">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[#3E4A6B]">
            <span>Tax</span>
            <span className="tabular-nums">{formatMoney(invoice.taxAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold text-[#0B1E3F] pt-1 border-t border-[#E5E9F2]">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(invoice.total)}</span>
          </div>
        </div>

        {(canSend || canVoid) && (
          <div className="flex flex-wrap gap-2 pt-2">
            {canSend && (
              <button
                onClick={handleSend}
                disabled={sending}
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
                {sending ? "Sending…" : "Send invoice"}
              </button>
            )}
            {invoice.status === "DRAFT" && !kybApproved && (
              <span className="text-xs text-[#7C8CA6] self-center">
                Sending requires an approved KYB.
              </span>
            )}
            {canVoid && !confirmVoid && (
              <button onClick={() => setConfirmVoid(true)} className="btn-3d btn-3d--sm btn-3d--neutral">
                Void invoice
              </button>
            )}
          </div>
        )}

        {confirmVoid && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm text-amber-800">Voiding an invoice can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={handleVoid}
                disabled={voiding}
                className="btn-3d btn-3d--sm"
                style={
                  {
                    "--btn-bg": "#DC2626",
                    "--btn-bg-hover": "#c81e1e",
                    "--btn-edge": "#991b1b",
                    "--btn-edge-hover": "#7f1d1d",
                    color: "#ffffff",
                  } as React.CSSProperties
                }
              >
                {voiding ? "Voiding…" : "Confirm void"}
              </button>
              <button onClick={() => setConfirmVoid(false)} className="btn-3d btn-3d--sm btn-3d--neutral">
                Cancel
              </button>
            </div>
          </div>
        )}

        {invoice.events.length > 0 && (
          <div className="pt-4 border-t border-[#F2F4F8]">
            <p className="text-xs font-semibold text-[#7C8CA6] mb-3">History</p>
            <ol className="space-y-3">
              {invoice.events.map((ev) => (
                <li key={ev.id} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-[#2A5CE6] shrink-0" />
                  <span className="text-sm text-[#0B1E3F]">{EVENT_LABEL[ev.eventType] ?? ev.eventType}</span>
                  <span className="text-xs text-[#7C8CA6]">{formatDate(ev.createdAt)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}