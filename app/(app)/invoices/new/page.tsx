// app/(app)/invoices/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { formatUSDC } from "@/app/invoices/_components/format";
import { useFeedback } from "@/app/(app)/_components/FeedbackProvider";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

const STEPS = [
  { id: 1, label: "Recipient" },
  { id: 2, label: "Items" },
  { id: 3, label: "Review" },
] as const;

const PRIMARY_BTN = {
  "--btn-bg": "#2A5CE6",
  "--btn-bg-hover": "#2450d1",
  "--btn-edge": "#1A3FA8",
  "--btn-edge-hover": "#17358f",
  color: "#ffffff",
} as React.CSSProperties;

function emptyLineItem(): LineItem {
  return { description: "", quantity: "1", unitPrice: "" };
}

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function lineTotalPreview(item: LineItem): string {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unitPrice) || 0;
  return (qty * price).toFixed(2);
}

export default function NewInvoicePage() {
  const router = useRouter();
  const { cue } = useFeedback();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [recipientIdentifier, setRecipientIdentifier] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [dueDate, setDueDate] = useState(() => todayPlusDays(14));
  const [taxAmount, setTaxAmount] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; total: string } | null>(null);

  const subtotalPreview = lineItems.reduce((sum, li) => {
    const qty = Number(li.quantity) || 0;
    const price = Number(li.unitPrice) || 0;
    return sum + qty * price;
  }, 0);
  const taxPreview = Number(taxAmount) || 0;
  const totalPreview = subtotalPreview + taxPreview;

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  function addLineItem() {
    cue("tap");
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    if (lineItems.length <= 1) return;
    cue("tap");
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  function validateRecipient(): boolean {
    if (!recipientIdentifier.trim()) {
      setError("Add the person or business this invoice is for.");
      cue("error");
      return false;
    }
    const email = recipientEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email doesn't look right.");
      cue("error");
      return false;
    }
    return true;
  }

  function validateItems(): boolean {
    for (const li of lineItems) {
      if (!li.description.trim() || !li.quantity.trim() || !li.unitPrice.trim()) {
        setError("Give every line a description, quantity, and price.");
        cue("error");
        return false;
      }
      if (!/^\d+(\.\d{1,4})?$/.test(li.quantity.trim()) || Number(li.quantity) <= 0) {
        setError("Quantities must be numbers greater than zero.");
        cue("error");
        return false;
      }
      if (!/^\d+(\.\d{1,6})?$/.test(li.unitPrice.trim()) || Number(li.unitPrice) <= 0) {
        setError("Unit prices must be numbers greater than zero.");
        cue("error");
        return false;
      }
    }
    return true;
  }

  function validateTerms(): boolean {
    if (!dueDate) {
      setError("Pick a due date.");
      cue("error");
      return false;
    }
    if (dueDate < todayPlusDays(0)) {
      setError("Due date can't be in the past.");
      cue("error");
      return false;
    }
    const tax = taxAmount.trim();
    if (tax && (!/^\d+(\.\d{1,6})?$/.test(tax) || Number(tax) < 0)) {
      setError("Tax must be a valid USDC amount.");
      cue("error");
      return false;
    }
    return true;
  }

  function goNext() {
    setError(null);
    if (step === 1) {
      if (!validateRecipient()) return;
      cue("next");
      setDirection("forward");
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!validateItems()) return;
      cue("next");
      setDirection("forward");
      setStep(3);
    }
  }

  function goBack() {
    setError(null);
    if (step === 1) return;
    cue("back");
    setDirection("back");
    setStep(step === 3 ? 2 : 1);
  }

  async function createInvoice() {
    setError(null);
    if (!validateRecipient() || !validateItems() || !validateTerms()) return;

    cue("tap");
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
          lineItems: lineItems.map((li) => ({
            description: li.description.trim(),
            quantity: li.quantity.trim(),
            unitPrice: li.unitPrice.trim(),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create invoice");
        cue("error");
        return;
      }
      setCreated({ id: data.invoice.id, total: data.invoice.total });
      cue("success");
    } catch {
      setError("Could not create invoice");
      cue("error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < 3) {
      goNext();
      return;
    }
    void createInvoice();
  }

  function reset() {
    cue("tap");
    setCreated(null);
    setStep(1);
    setDirection("forward");
    setRecipientIdentifier("");
    setRecipientEmail("");
    setDueDate(todayPlusDays(14));
    setTaxAmount("");
    setLineItems([emptyLineItem()]);
    setError(null);
  }

  if (created) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <style>{`
          @keyframes invoiceFadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes invoiceSuccessPop {
            0%   { opacity: 0; transform: scale(.6) }
            60%  { opacity: 1; transform: scale(1.08) }
            100% { opacity: 1; transform: scale(1) }
          }
          @keyframes invoiceSparkle {
            0%, 100% { transform: translateY(0) rotate(0deg); opacity: .7 }
            50%      { transform: translateY(-4px) rotate(10deg); opacity: 1 }
          }
        `}</style>

        <div className="flex flex-col items-center py-10 text-center animate-[invoiceFadeIn_.25s_ease]">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 animate-[invoiceSuccessPop_.5s_cubic-bezier(.22,1,.36,1)]">
            <CheckCircle2 size={42} strokeWidth={2.2} />
            <Sparkles
              size={18}
              className="absolute -right-2 -top-1 text-amber-400 animate-[invoiceSparkle_1.4s_ease-in-out_infinite]"
            />
          </div>

          <h2 className="mt-5 text-2xl font-semibold text-[#0B1E3F]">Invoice created</h2>
          <p className="mt-1 max-w-sm text-sm text-[#7C8CA6]">
            Ready to send to {recipientIdentifier}.
          </p>

          <div className="mt-6 w-full max-w-xs rounded-2xl border border-[#E5E9F2] bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-[#7C8CA6]">Total</p>
            <p className="mt-1 text-3xl font-semibold text-[#0B1E3F] tabular-nums">
              {formatUSDC(created.total)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              cue("tap");
              router.push(`/invoices/${created.id}`);
              router.refresh();
            }}
            className="btn-3d mt-7 w-full max-w-xs"
            style={PRIMARY_BTN}
          >
            View invoice
          </button>
          <button
            type="button"
            onClick={reset}
            className="mt-2 w-full max-w-xs rounded-xl px-4 py-2.5 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8]"
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <style>{`
        @keyframes invoiceStepForward {
          from { opacity: 0; transform: translateX(24px) }
          to   { opacity: 1; transform: translateX(0) }
        }
        @keyframes invoiceStepBack {
          from { opacity: 0; transform: translateX(-24px) }
          to   { opacity: 1; transform: translateX(0) }
        }
        @keyframes invoiceLineIn {
          from { opacity: 0; transform: translateY(8px) scale(.98) }
          to   { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>

      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => {
              cue("back");
              router.push("/invoices");
            }}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#2A5CE6] hover:underline"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Invoices
          </button>
          <h1 className="mt-3 text-xl font-semibold text-[#0B1E3F]">New invoice</h1>
        </div>
        <span className="rounded-full border border-[#E5E9F2] bg-white px-3 py-1 text-xs font-semibold text-[#3E4A6B]">
          Step {step} of 3
        </span>
      </div>

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-4">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#7C8CA6] sm:text-xs">
          {STEPS.map((s) => (
            <span
              key={s.id}
              className={`transition-colors ${step >= s.id ? "text-[#2A5CE6]" : ""}`}
            >
              {s.id}. {s.label}
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          {STEPS.map((s) => (
            <div key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E5E9F2]">
              <div
                className={`h-full rounded-full bg-[#2A5CE6] transition-all duration-500 ${
                  step >= s.id ? "w-full" : "w-0"
                }`}
              />
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        <div
          key={step}
          className={`min-h-[360px] ${
            direction === "forward"
              ? "animate-[invoiceStepForward_.35s_cubic-bezier(.22,1,.36,1)]"
              : "animate-[invoiceStepBack_.35s_cubic-bezier(.22,1,.36,1)]"
          }`}
        >
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEF3FF] text-[#2A5CE6]">
                  <User size={20} />
                </div>
                <h2 className="text-lg font-semibold text-[#0B1E3F]">
                  Who is this invoice for?
                </h2>
                <p className="mt-1 text-sm text-[#7C8CA6]">
                  Add their @username, 0x address, or email.
                </p>
              </div>

              <div>
                <label
                  htmlFor="recipient"
                  className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                >
                  Recipient
                </label>
                <div className="relative">
                  <User
                    size={16}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7C8CA6]"
                  />
                  <input
                    id="recipient"
                    autoFocus
                    value={recipientIdentifier}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRecipientIdentifier(val.startsWith("@") ? val.slice(1) : val);
                    }}
                    placeholder="acme or 0x1234…"
                    className="w-full rounded-xl border border-[#E5E9F2] bg-white py-3 pl-11 pr-4 text-sm text-[#0B1E3F] transition-shadow focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="recipientEmail"
                  className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                >
                  Recipient email <span className="font-normal text-[#7C8CA6]">(optional)</span>
                </label>
                <input
                  id="recipientEmail"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="billing@acme.com"
                  className="w-full rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm text-[#0B1E3F] transition-shadow focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10"
                />
                <p className="mt-1.5 text-xs text-[#7C8CA6]">
                  We&apos;ll use this to send the invoice when you&apos;re ready.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEF3FF] text-[#2A5CE6]">
                  <FileText size={20} />
                </div>
                <h2 className="text-lg font-semibold text-[#0B1E3F]">
                  What are you billing for?
                </h2>
                <p className="mt-1 text-sm text-[#7C8CA6]">
                  Break the work into clear lines. Add as many as you need.
                </p>
              </div>

              <div className="space-y-3">
                {lineItems.map((li, i) => (
                  <div
                    key={i}
                    className="animate-[invoiceLineIn_.3s_cubic-bezier(.22,1,.36,1)] rounded-2xl border border-[#E5E9F2] bg-white p-4 transition-all focus-within:border-[#2A5CE6] focus-within:shadow-[0_0_0_4px_rgba(42,92,230,0.08)]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F2F4F8] text-xs font-semibold text-[#3E4A6B]">
                        {i + 1}
                      </span>

                      <div className="min-w-0 flex-1 space-y-3">
                        <input
                          value={li.description}
                          onChange={(e) => updateLineItem(i, { description: e.target.value })}
                          placeholder="Description (e.g. Brand design sprint)"
                          className="w-full rounded-lg border border-[#E5E9F2] px-3 py-2 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label
                              htmlFor={`quantity-${i}`}
                              className="mb-1 block text-xs font-medium text-[#7C8CA6]"
                            >
                              Qty
                            </label>
                            <input
                              id={`quantity-${i}`}
                              value={li.quantity}
                              onChange={(e) => updateLineItem(i, { quantity: e.target.value })}
                              inputMode="decimal"
                              className="w-full rounded-lg border border-[#E5E9F2] px-3 py-2 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`unitPrice-${i}`}
                              className="mb-1 block text-xs font-medium text-[#7C8CA6]"
                            >
                              Unit price (USDC)
                            </label>
                            <input
                              id={`unitPrice-${i}`}
                              value={li.unitPrice}
                              onChange={(e) => updateLineItem(i, { unitPrice: e.target.value })}
                              inputMode="decimal"
                              placeholder="0.00"
                              className="w-full rounded-lg border border-[#E5E9F2] px-3 py-2 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {lineItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLineItem(i)}
                          aria-label={`Remove line ${i + 1}`}
                          className="mt-1 rounded-lg p-1.5 text-[#7C8CA6] transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>

                    <div className="mt-3 flex justify-end text-xs text-[#7C8CA6]">
                      Line total
                      <span className="ml-1 font-semibold text-[#0B1E3F] tabular-nums">
                        {formatUSDC(lineTotalPreview(li))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addLineItem}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#C9D4EA] bg-[#F9FBFF] px-4 py-3 text-sm font-semibold text-[#2A5CE6] transition-colors hover:border-[#2A5CE6] hover:bg-[#EEF3FF]"
              >
                <Plus size={16} /> Add another line
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEF3FF] text-[#2A5CE6]">
                  <CalendarDays size={20} />
                </div>
                <h2 className="text-lg font-semibold text-[#0B1E3F]">Set the terms</h2>
                <p className="mt-1 text-sm text-[#7C8CA6]">
                  Choose when it&apos;s due and add tax if it applies.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="dueDate"
                    className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                  >
                    Due date
                  </label>
                  <input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    min={todayPlusDays(0)}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tax"
                    className="mb-2 block text-sm font-semibold text-[#0B1E3F]"
                  >
                    Tax <span className="font-normal text-[#7C8CA6]">(optional, USDC)</span>
                  </label>
                  <input
                    id="tax"
                    type="text"
                    inputMode="decimal"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-[#E5E9F2] bg-white px-4 py-3 text-sm text-[#0B1E3F] focus:border-[#2A5CE6] focus:outline-none focus:ring-4 focus:ring-[#2A5CE6]/10"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-[#E5E9F2] bg-[#F9FBFF] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1E3F]">
                  <Sparkles size={16} className="text-[#2A5CE6]" />
                  Invoice preview
                </div>
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-[#7C8CA6]">Recipient</span>
                  <span className="max-w-[60%] truncate font-medium text-[#0B1E3F]">
                    {recipientIdentifier}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#7C8CA6]">Line items</span>
                  <span className="font-medium text-[#0B1E3F]">{lineItems.length}</span>
                </div>
                <div className="space-y-2 border-t border-[#E5E9F2] pt-3">
                  <div className="flex justify-between text-sm text-[#3E4A6B]">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatUSDC(subtotalPreview.toFixed(2))}</span>
                  </div>
                  <div className="flex justify-between text-sm text-[#3E4A6B]">
                    <span>Tax</span>
                    <span className="tabular-nums">{formatUSDC(taxPreview.toFixed(2))}</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold text-[#0B1E3F]">
                    <span>Total</span>
                    <span className="tabular-nums">{formatUSDC(totalPreview.toFixed(2))}</span>
                  </div>
                </div>
                <p className="text-xs text-[#7C8CA6]">
                  Final totals are calculated securely by the server.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#F2F4F8] pt-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={goBack}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-[#3E4A6B] transition-colors hover:bg-[#F2F4F8] disabled:opacity-50"
            >
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <span />
          )}

          {step < 3 ? (
            <button type="submit" className="btn-3d min-w-[150px]" style={PRIMARY_BTN}>
              Continue <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="btn-3d min-w-[170px]"
              style={PRIMARY_BTN}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Create invoice
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
