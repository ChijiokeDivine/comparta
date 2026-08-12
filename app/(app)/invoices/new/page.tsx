// app/(app)/invoices/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { KybBanner } from "../../_components/Kyb";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

function emptyLineItem(): LineItem {
  return { description: "", quantity: "1", unitPrice: "" };
}

export default function NewInvoicePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const kybStatus = session?.user?.kybStatus ?? "PENDING";
  const disabled = kybStatus !== "APPROVED";
  const [recipientIdentifier, setRecipientIdentifier] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotalPreview = lineItems.reduce((sum, li) => {
    const qty = Number(li.quantity) || 0;
    const price = Number(li.unitPrice) || 0;
    return sum + qty * price;
  }, 0);
  const taxPreview = Number(taxAmount) || 0;

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!recipientIdentifier.trim() || !dueDate) {
      setError("Recipient and due date are required.");
      return;
    }
    if (lineItems.some((li) => !li.description.trim() || !li.quantity.trim() || !li.unitPrice.trim())) {
      setError("Every line item needs a description, quantity, and unit price.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientIdentifier: recipientIdentifier.trim(),
          recipientEmail: recipientEmail.trim() || undefined,
          dueDate,
          taxAmount: taxAmount.trim() || undefined,
          lineItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create invoice");
        return;
      }
      router.push(`/invoices/${data.invoice.id}`);
      router.refresh();
    } catch {
      setError("Could not create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <KybBanner status={kybStatus} />
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New invoice</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="recipient" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
              Recipient (@username or 0x address)
            </label>
            <input
              id="recipient"
              disabled={disabled}
              value={recipientIdentifier}
              onChange={(e) => {
                const val = e.target.value;
                setRecipientIdentifier(val.startsWith("@") ? val.slice(1) : val);
              }}
              placeholder="@acme or 0x1234…"
              className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
            />
          </div>
          <div>
            <label htmlFor="recipientEmail" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
              Recipient email <span className="font-normal text-[#7C8CA6]">(optional)</span>
            </label>
            <input
              id="recipientEmail"
              disabled={disabled}
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
            />
          </div>
          <div>
            <label htmlFor="dueDate" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
              Due date
            </label>
            <input
              id="dueDate"
              disabled={disabled}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
            />
          </div>
          <div>
            <label htmlFor="tax" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
              Tax <span className="font-normal text-[#7C8CA6]">(optional, USDC)</span>
            </label>
            <input
              id="tax"
              disabled={disabled}
              type="text"
              inputMode="decimal"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-[#0B1E3F]">Line items</p>
            <button type="button" onClick={addLineItem} className="text-sm font-medium text-[#2A5CE6] hover:underline">
              + Add line
            </button>
          </div>

          <div className="space-y-3">
            {lineItems.map((li, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2 rounded-xl border border-[#E5E9F2] p-3">
                <input
                  value={li.description}
                  onChange={(e) => updateLineItem(i, { description: e.target.value })}
                  placeholder="Description"
                  className="flex-1 min-w-[140px] px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
                />
                <input
                  value={li.quantity}
                  onChange={(e) => updateLineItem(i, { quantity: e.target.value })}
                  placeholder="Qty"
                  inputMode="decimal"
                  className="w-20 px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
                />
                <input
                  value={li.unitPrice}
                  onChange={(e) => updateLineItem(i, { unitPrice: e.target.value })}
                  placeholder="Unit price"
                  inputMode="decimal"
                  className="w-28 px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
                />
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(i)}
                    className="text-xs font-medium text-red-600 hover:underline px-1 py-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[#F7F8FB] p-4 space-y-1 text-sm">
          <div className="flex justify-between text-[#3E4A6B]">
            <span>Subtotal (preview)</span>
            <span className="tabular-nums">{subtotalPreview.toFixed(2)} USDC</span>
          </div>
          <div className="flex justify-between text-[#3E4A6B]">
            <span>Tax</span>
            <span className="tabular-nums">{taxPreview.toFixed(2)} USDC</span>
          </div>
          <div className="flex justify-between font-semibold text-[#0B1E3F] pt-1 border-t border-[#E5E9F2]">
            <span>Total (preview)</span>
            <span className="tabular-nums">{(subtotalPreview + taxPreview).toFixed(2)} USDC</span>
          </div>
          <p className="text-xs text-[#7C8CA6] pt-1">
            Final totals are computed by the server — this is just a preview.
          </p>
        </div>

        <button
          type="submit"
          disabled={disabled || submitting}
          className="btn-3d w-full"
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
          {submitting ? "Creating…" : "Create invoice"}
        </button>
      </form>
    </div>
  );
}