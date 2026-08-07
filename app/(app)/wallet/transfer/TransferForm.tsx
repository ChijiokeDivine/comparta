// app/(app)/wallet/transfer/TransferForm.tsx
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

interface ResolveResult {
  type: "USERNAME" | "ADDRESS";
  address: string;
  displayName: string | null;
  username: string | null;
}

export default function TransferForm({ buckets, disabled }: { buckets: Bucket[]; disabled: boolean }) {
  const router = useRouter();
  const [fromLedgerAccountId, setFromLedgerAccountId] = useState(buckets[0]?.id ?? "");
  const [toIdentifier, setToIdentifier] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable per-mount idempotency key, reused across retries within this
  // session so a double-submit (or a retry after a network blip) can
  // never double-send - see app/api/transfers/send/route.ts.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  async function handleIdentifierBlur() {
    setResolved(null);
    setResolveError(null);
    if (!toIdentifier.trim()) return;

    setResolving(true);
    try {
      const res = await fetch(`/api/resolve/${encodeURIComponent(toIdentifier.trim())}`);
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
              {b.name} — {b.balance} USDC
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="to" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          To (@username or 0x address)
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