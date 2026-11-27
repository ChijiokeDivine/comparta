// app/(app)/wallet/unified-balance/deposit/UnifiedDepositForm.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import { SETTLEMENT_CHAIN } from "@/lib/config/clientChains";

// Deposits are Arc-only (Arc mainnet in production) — there is no source
// chain picker. The API route independently validates the chain against
// DEPOSIT_SOURCE_SUPPORTED_CHAINS server-side.
const SOURCE_CHAIN = SETTLEMENT_CHAIN;

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 90_000;

// USDC has 6 decimals. Doing the sequential debit math in integer micro-units
// avoids floating-point drift when splitting an amount across buckets.
const MICRO = 1_000_000;

function toMicros(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * MICRO);
}

function microsToString(units: number): string {
  const whole = Math.floor(units / MICRO);
  const frac = units % MICRO;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(6, "0").replace(/0+$/, "")}`;
}

interface AllocationRow {
  bucket: Bucket;
  debitMicros: number;
}

// Walk the buckets in order, debiting as much as each can cover.
function computeAllocations(buckets: Bucket[], totalMicros: number) {
  const rows: AllocationRow[] = [];
  let remaining = totalMicros;
  for (const bucket of buckets) {
    const debitMicros = Math.min(toMicros(bucket.balance), remaining);
    remaining -= debitMicros;
    rows.push({ bucket, debitMicros });
  }
  return {
    rows,
    debitedMicros: totalMicros - remaining,
    shortfallMicros: remaining,
  };
}

interface Bucket {
  id: string;
  name: string;
  balance: string;
}

export default function UnifiedDepositForm({
  walletAddress,
  buckets,
  disabled,
}: {
  walletAddress: string;
  buckets: Bucket[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  // Bucket order defines the debit order: the first bucket is drained first,
  // then the next, until the requested amount is covered.
  const [order, setOrder] = useState<string[]>(() => buckets.map((b) => b.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string; explorerUrl?: string } | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmedAfter, setConfirmedAfter] = useState<string | null>(null);
  const baselineConfirmedRef = useRef<number | null>(null);
  const depositedAmountRef = useRef<number>(0);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  // Keep the order in sync if buckets are added/removed by a server refresh:
  // known ids stay in their user-defined order, new ids are appended.
  const orderedBuckets = [
    ...order
      .map((id) => buckets.find((b) => b.id === id))
      .filter((b): b is Bucket => Boolean(b)),
    ...buckets.filter((b) => !order.includes(b.id)),
  ];

  const totalMicros = toMicros(amount);
  const {
    rows: autoAllocations,
    debitedMicros,
    shortfallMicros,
  } = computeAllocations(orderedBuckets, totalMicros);
  const canReorder = !disabled && !submitting && !confirming;

  function moveBucket(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const base = orderedBuckets.map((b) => b.id);
    const sourceIndex = base.indexOf(sourceId);
    const targetIndex = base.indexOf(targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    const next = base.filter((id) => id !== sourceId);
    // Inserting at the target's original index means "after" when moving
    // down and "before" when moving up — so dropping on the last row can
    // move a bucket to the end.
    next.splice(targetIndex, 0, sourceId);
    setOrder(next);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (!canReorder) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(id);
    setDragOverId(null);
    dragOverIdRef.current = null;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    const row = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-bucket-id]");
    const overId = row?.dataset.bucketId;
    const target = overId && overId !== draggingId ? overId : null;
    dragOverIdRef.current = target;
    setDragOverId(target);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const target = dragOverIdRef.current;
    if (target && target !== draggingId) {
      moveBucket(draggingId, target);
    }
    dragOverIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragOverIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  }

  function handleReorderKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!canReorder) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const index = orderedBuckets.findIndex((b) => b.id === id);
    const neighbour = orderedBuckets[e.key === "ArrowUp" ? index - 1 : index + 1];
    if (neighbour) moveBucket(id, neighbour.id);
  }

  useEffect(() => {
    if (!confirming || ready) return;
    const started = Date.now();
    let cancelled = false;

    async function poll() {
      while (!cancelled && Date.now() - started < POLL_TIMEOUT_MS) {
        try {
          const res = await fetch("/api/wallet/unified-balance");
          const data = await res.json();
          if (res.ok && !cancelled) {
            const confirmed = parseFloat(data.totalConfirmed ?? "0");
            const baseline = baselineConfirmedRef.current ?? 0;
            const target = baseline + Math.max(0, depositedAmountRef.current * 0.9);
            if (Number.isFinite(confirmed) && confirmed >= target && confirmed > baseline) {
              setConfirmedAfter(data.totalConfirmed ?? "0");
              setReady(true);
              setConfirming(false);
              router.refresh();
              return;
            }
            setConfirmedAfter(data.totalConfirmed ?? "0");
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled) {
        setConfirming(false);
        router.refresh();
      }
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, [confirming, ready, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setReady(false);
    setConfirming(false);
    setConfirmedAfter(null);

    if (!/^\d+(\.\d{1,6})?$/.test(amount.trim()) || totalMicros <= 0) {
      setError("Enter a valid USDC amount (up to 6 decimal places).");
      return;
    }

    if (shortfallMicros > 0) {
      setError(
        `Not enough balance across buckets. Short by ${microsToString(shortfallMicros)} USDC.`
      );
      return;
    }

    const allocations = autoAllocations
      .filter((a) => a.debitMicros > 0)
      .map((a) => ({
        ledgerAccountId: a.bucket.id,
        amount: microsToString(a.debitMicros),
      }));

    if (!allocations.length) {
      setError("No bucket balance available to debit.");
      return;
    }

    setSubmitting(true);
    try {
      try {
        const balRes = await fetch("/api/wallet/unified-balance");
        const bal = await balRes.json();
        if (balRes.ok) {
          baselineConfirmedRef.current = parseFloat(bal.totalConfirmed ?? "0");
        } else {
          baselineConfirmedRef.current = 0;
        }
      } catch {
        baselineConfirmedRef.current = 0;
      }
      depositedAmountRef.current = debitedMicros / MICRO;

      const res = await fetch("/api/wallet/unified-balance/deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          sourceChain: SOURCE_CHAIN,
          amount: microsToString(totalMicros),
          allocations,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Deposit failed");
        return;
      }
      setResult(data.deposit);
      setConfirming(true);
      router.refresh();
    } catch {
      setError("Deposit failed. Please try again.");
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

      {result && (
        <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 space-y-1">
          <p className="font-semibold">Deposit submitted — buckets debited.</p>
          <p className="font-mono text-xs break-all">{result.txHash}</p>
          {result.explorerUrl && (
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="underline">
              View on explorer
            </a>
          )}
        </div>
      )}

      {confirming && !ready && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-semibold">Waiting for confirmation…</p>
          <p className="text-xs text-blue-800/80 mt-1">
            Gateway is confirming your deposit.
            {confirmedAfter != null && (
              <> Current confirmed: <span className="font-mono">{confirmedAfter}</span> USDC.</>
            )}
          </p>
        </div>
      )}

      {ready && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 space-y-2">
          <p className="font-semibold">Ready to send</p>
          <p>
            Unified Balance confirmed
            {confirmedAfter != null && (
              <> at <span className="font-semibold">{confirmedAfter} USDC</span></>
            )}
            .
          </p>
          <Link href="/wallet/transfer" className="inline-flex text-xs font-semibold text-[#2A5CE6] hover:underline">
            Go to New transfer →
          </Link>
        </div>
      )}

      <div>
        <label htmlFor="amount" className="block text-sm font-semibold text-[#0B1E3F] mb-2">
          Total amount (USDC)
        </label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled || submitting || confirming}
          placeholder="0.00"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E9F2] text-[#0B1E3F] focus:border-[#2A5CE6] text-sm disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-semibold text-[#0B1E3F]">Debit from buckets</label>
          <span className="text-xs text-[#7C8CA6]">
            {totalMicros > 0
              ? `Debiting ${microsToString(debitedMicros)} / ${microsToString(totalMicros)}`
              : "Order top to bottom"}
          </span>
        </div>
        <p className="text-xs text-[#7C8CA6]">
          Drag to reorder. We debit the first bucket first, then the next, until the amount is covered.
        </p>
        <div className="overflow-hidden rounded-xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {orderedBuckets.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[#7C8CA6]">No buckets available.</p>
          ) : (
            autoAllocations.map(({ bucket: b, debitMicros }, index) => {
              const isDragging = draggingId === b.id;
              const isOver = dragOverId === b.id && draggingId !== b.id;
              return (
                <div
                  key={b.id}
                  data-bucket-id={b.id}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    isDragging ? "opacity-40" : ""
                  } ${isOver ? "bg-[#EEF3FF]" : ""}`}
                >
                  <button
                    type="button"
                    aria-label={`Reorder ${b.name}. Use arrow keys to move up or down.`}
                    title="Drag to reorder"
                    disabled={!canReorder}
                    onPointerDown={(e) => handlePointerDown(e, b.id)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onKeyDown={(e) => handleReorderKeyDown(e, b.id)}
                    className={`shrink-0 touch-none rounded p-0.5 text-[#B7C2D6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2A5CE6]/30 disabled:opacity-50 ${
                      canReorder
                        ? "cursor-grab hover:text-[#3E4A6B] active:cursor-grabbing"
                        : ""
                    }`}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </button>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F2F4F8] text-xs font-semibold text-[#3E4A6B]">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0B1E3F] truncate">{b.name}</p>
                    <p className="text-xs text-[#7C8CA6]">{b.balance} USDC</p>
                  </div>
                  {debitMicros > 0 ? (
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-[#0B1E3F]">
                        −{microsToString(debitMicros)}
                      </p>
                      <p className="text-[11px] text-[#7C8CA6]">debited</p>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-[#B7C2D6]">Not used</span>
                  )}
                </div>
              );
            })
          )}
        </div>
        {totalMicros > 0 && shortfallMicros > 0 && (
          <p className="text-xs font-medium text-amber-700">
            Short by {microsToString(shortfallMicros)} USDC across all buckets.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={disabled || submitting || confirming}
        className="btn-3d w-full"
        style={{
          "--btn-bg": "#2A5CE6",
          "--btn-bg-hover": "#2450d1",
          "--btn-edge": "#1A3FA8",
          "--btn-edge-hover": "#17358f",
          color: "#ffffff",
        } as React.CSSProperties}
      >
        {submitting ? "Depositing…" : confirming ? "Confirming…" : "Fund Unified Balance"}
      </button>
    </form>
  );
}
