// app/(app)/wallet/transfer/TransferForm.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search as SearchIcon, X, ArrowRight, FileText } from "lucide-react";
import Image from "next/image";
interface Bucket {
  id: string;
  name: string;
  balance: string;
}

interface Contact {
  id: string;
  displayName: string;
  identifier: string;
  identifierType: "USERNAME" | "ADDRESS";
}

interface ResolveResult {
  type: "USERNAME" | "ADDRESS";
  address: string;
  displayName: string | null;
  username: string | null;
}

export default function TransferForm({
  buckets,
  disabled,
  initialTo,
}: {
  buckets: Bucket[];
  disabled: boolean;
  initialTo?: string;
}) {
  const router = useRouter();
  const [fromLedgerAccountId, setFromLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [toIdentifier, setToIdentifier] = useState(initialTo ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  // Resolve whatever initialTo was seeded with, once, on mount.
  useEffect(() => {
    if (!toIdentifier.trim()) return;
    void handleResolve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePicker() {
    setPickerOpen((o) => {
      const next = !o;
      if (next) setContactsLoading(true);
      return next;
    });
  }

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setContacts(data.contacts ?? []);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen]);

  const filteredContacts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.identifier.toLowerCase().includes(q)
    );
  }, [contacts, pickerQuery]);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  // Accepts an optional override so a caller with a fresh value in hand
  // (like pickContact, right after calling setToIdentifier) can resolve
  // that value directly instead of relying on `toIdentifier` state,
  // which won't have re-rendered yet in the same tick.
  async function handleResolve(overrideValue?: string) {
    const value = (overrideValue ?? toIdentifier).trim();
    setResolved(null);
    setResolveError(null);
    if (!value) return;

    setResolving(true);
    try {
      const res = await fetch(`/api/resolve/${encodeURIComponent(value)}`);
      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error ?? "Could not resolve this recipient");
        return;
      }
      setResolved(data);
    } catch {
      setResolveError("Could not resolve this recipient");
    } finally {
      setResolving(false);
    }
  }

  async function handleIdentifierBlur() {
    await handleResolve();
  }

  function pickContact(contact: Contact) {
    setToIdentifier(contact.identifier);
    setPickerOpen(false);
    setPickerQuery("");
    handleResolve(contact.identifier);
  }

  // const fromBucket = useMemo(
  //   () => buckets.find((b) => b.id === fromLedgerAccountId) ?? null,
  //   [buckets, fromLedgerAccountId]
  // );

  function truncateAddress(addr: string, start = 7, end = 7) {
    if (addr.length <= start + end + 2) return addr;
    return `${addr.slice(0, start)}..${addr.slice(-end)}`;
  }

  function handleConfirmClick(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fromLedgerAccountId) {
      setError("Choose a bucket to send from.");
      return;
    }
    if (!resolved) {
      setError("Resolve a valid recipient before sending.");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setConfirmOpen(true);
  }

  async function handleTransfer() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          fromLedgerAccountId,
          toIdentifier: toIdentifier.trim(),
          amount: amount.trim(),
          memo: memo.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Transfer failed");
        setConfirmOpen(false);
        return;
      }
      router.push("/wallet/transfers");
      router.refresh();
    } catch {
      setError("Transfer failed. Please try again.");
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [confirmOpen]);

  return (
    <>
      <form onSubmit={handleConfirmClick} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="from" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          From
        </label>
        <select
          id="from"
          value={fromLedgerAccountId}
          onChange={(e) => setFromLedgerAccountId(e.target.value)}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        >
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} - {b.balance} USDC
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="to" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
            To
          </label>
          <button
            type="button"
            onClick={togglePicker}
            disabled={disabled}
            className="text-xs font-semibold text-[#2A5CE6] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pickerOpen ? "Hide contacts" : "Pick from contacts"}
          </button>
        </div>

        {pickerOpen && (
          <div className="rounded-xl border border-[#E5E9F2] bg-white overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F2F4F8] bg-[#FBFBFD]">
              <SearchIcon className="w-4 h-4 text-[#7C8CA6] shrink-0" />
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search contacts by name or address…"
                className="w-full bg-transparent text-sm text-[#0B1E3F] placeholder:text-[#7C8CA6] focus:outline-none"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {contactsLoading ? (
                <div className="px-4 py-6 text-center text-xs text-[#7C8CA6]">Loading contacts…</div>
              ) : filteredContacts.length === 0 ? (
                <div className="px-4 py-6 text-center space-y-2">
                  <p className="text-xs text-[#7C8CA6]">
                    {contacts.length === 0 ? "No saved contacts yet." : "No contacts match your search."}
                  </p>
                  {contacts.length === 0 && (
                    <Link
                      href="/contacts/new"
                      className="inline-block text-xs font-semibold text-[#2A5CE6] hover:underline"
                    >
                      Add your first contact →
                    </Link>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-[#F2F4F8]">
                  {filteredContacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => pickContact(c)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#F7F8FB] transition-colors text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#0B1E3F] truncate">{c.displayName}</p>
                          <p className="text-xs font-mono text-[#7C8CA6] truncate">{c.identifier}</p>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#7C8CA6] px-2 py-1 rounded-full bg-[#F2F4F8]">
                          {c.identifierType === "USERNAME" ? "Username" : "Address"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <label className="block text-xs font-medium text-[#7C8CA6] mb-2">
          @username or 0x address
        </label>
        <input
          id="to"
          type="text"
          value={toIdentifier}
          onChange={(e) => {
            const val = e.target.value;
            setToIdentifier(val.startsWith("@") ? val.slice(1) : val);
          }}
          onBlur={handleIdentifierBlur}
          disabled={disabled}
          placeholder="@acme or 0x1234…"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
        {resolving && <p className="mt-1.5 text-xs text-[#7C8CA6]">Resolving…</p>}
        {resolved && (
          <p className="mt-1.5 text-xs text-emerald-700">
            ✓ {resolved.displayName ?? resolved.username ?? resolved.address}
          </p>
        )}
        {resolveError && <p className="mt-1.5 text-xs text-red-600">{resolveError}</p>}
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Amount (USDC)
        </label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="memo" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Memo <span className="font-normal text-[#7C8CA6]">(optional)</span>
        </label>
        <input
          id="memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={disabled}
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm md:text-base disabled:opacity-50"
        />
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
        {submitting ? "Sending…" : "Confirm"}
      </button>
    </form>

    {confirmOpen && (
      <div
        className="fixed inset-0 z-[100]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-confirm-title"
      >
        <button
          aria-label="Close transfer confirmation"
          onClick={() => setConfirmOpen(false)}
          className="absolute inset-0 bg-[#0B1E3F]/50 backdrop-blur-[2px] animate-[fadeIn_.18s_ease]"
          tabIndex={-1}
          disabled={submitting}
        />

        {/* Desktop Modal */}
        <div className="hidden md:flex md:items-center md:justify-center md:p-4 md:inset-0 md:absolute">
          <div className="relative w-full max-w-[520px] rounded-2xl bg-white shadow-[0_24px_80px_-20px_rgba(11,30,63,0.35)] animate-[popIn_.2s_ease] overflow-hidden">
            <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F8]">
              <div>
                <h2
                  id="transfer-confirm-title"
                  className="text-xl font-semibold text-[#0B1E3F]"
                >
                  Confirm transfer
                </h2>
                <p className="text-sm text-[#7C8CA6] mt-0.5">
                  Review the details below before sending
                </p>
              </div>
              <button
                onClick={() => setConfirmOpen(false)}
                aria-label="Close"
                disabled={submitting}
                className="rounded-full p-2 text-[#7C8CA6] hover:bg-[#F2F4F8] hover:text-[#0B1E3F] transition-colors disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center justify-center gap-3 py-3">
                
                <div className="shrink-0 w-9 h-9 rounded-full bg-[#2A5CE6]/10 flex items-center justify-center text-[#2A5CE6]">
                  <ArrowRight size={16} />
                </div>
                <div className="flex-1 rounded-xl border border-[#E5E9F2] p-4 text-center">
                 
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6] mb-1">To</p>
                 
                  <p className="text-sm font-semibold text-[#0B1E3F] truncate">
                    {resolved?.type === "USERNAME"
                      ? `@${resolved?.username ?? toIdentifier}`
                      : truncateAddress(resolved?.address ?? toIdentifier)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#E5EEFF]  p-5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#2A5CE6] mb-2 text-center">Amount</p>
                <div className="flex items-center justify-center gap-1">
                  <div className="shrink-0 w-7 h-7 rounded-full  flex items-center justify-center">
                    <Image
                      src="/usdc.png"
                      alt="USDC"
                      width={22}
                      height={22}
                      className="rounded-full"
                    />
                  </div>
                  <p className="text-2xl font-bold text-[#0B1E3F] tracking-tight">
                    {amount || "0.00"} 
                  </p>
                </div>
              </div>

              {memo.trim() && (
                <div className="rounded-xl border border-[#E5E9F2] p-4">
                  <div className="flex items-start gap-2.5">
                    <FileText size={15} className="mt-0.5 shrink-0 text-[#7C8CA6]" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-[#7C8CA6] mb-1">Memo</p>
                      <p className="text-sm text-[#0B1E3F] break-words">{memo}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 pt-2 border-t border-[#F2F4F8] bg-[#FBFBFD]">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 rounded-3xl border border-[#E5E9F2] text-sm font-semibold text-[#0B1E3F] bg-white hover:bg-[#F7F8FB] transition-colors disabled:opacity-50"
                >
                  Recheck
                </button>
                <button
                  type="button"
                  onClick={handleTransfer}
                  disabled={submitting}
                  className="btn-3d flex-1"
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
                  {submitting ? "Sending…" : "Transfer"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Drawer */}
        <div className="md:hidden fixed inset-x-0 bottom-0 top-0 flex items-end">
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-[0_-20px_60px_-15px_rgba(11,30,63,0.3)] animate-[slideUp_.25s_ease] overflow-hidden">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-[#D8DEE9]" />
            </div>
            <div className="flex items-start justify-between px-5 pt-2 pb-4 border-b border-[#F2F4F8]">
              <div>
                <h2 className="text-lg font-semibold text-[#0B1E3F]">Confirm transfer</h2>
                <p className="text-xs text-[#7C8CA6] mt-0.5">Review details before sending</p>
              </div>
              <button
                onClick={() => setConfirmOpen(false)}
                aria-label="Close"
                disabled={submitting}
                className="rounded-full p-2 text-[#7C8CA6] hover:bg-[#F2F4F8] transition-colors disabled:opacity-50 -mr-1 -mt-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-center gap-2.5 py-2">
               
                <div className="shrink-0 w-8 h-8 rounded-full bg-[#2A5CE6]/10 flex items-center justify-center text-[#2A5CE6]">
                  <ArrowRight size={14} />
                </div>
                <div className="flex-1 rounded-xl border border-[#E5E9F2]  p-3 text-center">
                  
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#7C8CA6] mb-0.5">To</p>
              
                  <p className="text-xs font-semibold text-[#0B1E3F] truncate">
                    {resolved?.type === "USERNAME"
                      ? `@${resolved?.username ?? toIdentifier}`
                      : truncateAddress(resolved?.address ?? toIdentifier)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#E5EEFF]  p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#2A5CE6] mb-2 text-center">Amount</p>
                <div className="flex items-center justify-center gap-1">
                  <div className="shrink-0 w-7 h-7 flex items-center justify-center">
                    <Image
                      src="/usdc.png"
                      alt="USDC"
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                  </div>
                  <p className="text-xl font-bold text-[#0B1E3F] tracking-tight">
                    {amount || "0.00"} 
                  </p>
                </div>
              </div>

              {memo.trim() && (
                <div className="rounded-xl border border-[#E5E9F2] p-3.5">
                  <div className="flex items-start gap-2">
                    <FileText size={14} className="mt-0.5 shrink-0 text-[#7C8CA6]" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-[#7C8CA6] mb-0.5">Memo</p>
                      <p className="text-xs text-[#0B1E3F] break-words">{memo}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 pb-6 pt-3 border-t border-[#F2F4F8] bg-[#FBFBFD] space-y-2.5">
              <button
                type="button"
                onClick={handleTransfer}
                disabled={submitting}
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
                {submitting ? "Sending…" : "Transfer"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-sm font-semibold text-[#0B1E3F] bg-white hover:bg-[#F7F8FB] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes popIn {
            from { opacity: 0; transform: translateY(8px) scale(.97) }
            to   { opacity: 1; transform: translateY(0)   scale(1) }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(100%) }
            to   { opacity: 1; transform: translateY(0) }
          }
        `}</style>
      </div>
    )}
    </>
  );
}