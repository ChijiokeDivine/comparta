// app/(app)/wallet/transfer/TransferForm.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

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

  // Fetch contacts whenever the picker opens. Depends ONLY on
  // pickerOpen — depending on contactsLoading here (as a prior version
  // did) creates a feedback loop: the effect sets contactsLoading(true),
  // which changes the dependency, which re-runs the effect, which
  // (once the fetch settles and sets it back to false) changes the
  // dependency again, forever. `cancelled` guards against a stale
  // response landing after the panel's been closed/reopened quickly.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setContactsLoading(true);
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

  async function handleSubmit(e: React.FormEvent) {
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
        return;
      }
      router.push("/wallet/transfers");
      router.refresh();
    } catch {
      setError("Transfer failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
            onClick={() => setPickerOpen((o) => !o)}
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
          onChange={(e) => setToIdentifier(e.target.value)}
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
        {submitting ? "Sending…" : "Send transfer"}
      </button>
    </form>
  );
}