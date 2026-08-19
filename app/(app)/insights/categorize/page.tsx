// app/(app)/insights/categorize/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import InsightsSubNav from "../_components/InsightsSubNav";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface Tx {
  id: string;
  amount: string;
  direction: "IN" | "OUT";
  counterpartyDisplayName: string | null;
  memo: string | null;
  referenceType: string | null;
  createdAt: string;
}

interface Category {
  id: string;
  name: string;
  kind: "SYSTEM" | "CUSTOM";
}

interface PendingItem {
  id: string;
  categoryId: string;
  source: "RULE" | "LLM";
  confidenceBps: number | null;
  needsConfirmation: boolean;
  llmSuggestedCategoryName: string | null;
  llmReasoning: string | null;
  createdAt: string;
  updatedAt: string;
  category: Category;
  onchainTransaction: Tx;
}

const CONFIDENCE_THRESHOLD_BPS = 7000;

function confidenceLabel(bps: number | null, source: PendingItem["source"]): string {
  if (source === "RULE") return "Rule match";
  if (bps == null) return "Suggested";
  const pct = Math.round(bps / 100);
  if (bps >= CONFIDENCE_THRESHOLD_BPS) return `${pct}% confident`;
  return `${pct}% (review)`;
}

export default function CategorizeNeedsReviewPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [overrideCategoryId, setOverrideCategoryId] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pendingRes, catRes] = await Promise.all([
          fetch("/api/insights/categorizations/pending", { cache: "no-store" }),
          fetch("/api/insights/categories", { cache: "no-store" }),
        ]);
        const pendingBody = await pendingRes.json().catch(() => ({}));
        const catBody = await catRes.json().catch(() => ({}));
        if (!pendingRes.ok) {
          setError(pendingBody.error ?? "Failed to load items to review");
          return;
        }
        if (catRes.ok) {
          setCategories(catBody.categories ?? []);
        }
        setItems(pendingBody.categorizations ?? []);
      } catch {
        setError("Failed to load items to review");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleConfirm(id: string) {
    setConfirmingId(id);
    try {
      const res = await fetch(`/api/insights/categorizations/${id}/confirm`, { method: "POST" });
      if (res.ok) {
        setItems((curr) => curr.filter((i) => i.id !== id));
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to confirm categorization");
      }
    } finally {
      setConfirmingId(null);
    }
  }

  function startOverride(item: PendingItem) {
    setOverridingId(item.id);
    setOverrideCategoryId(item.categoryId);
  }

  function cancelOverride() {
    setOverridingId(null);
    setOverrideCategoryId("");
  }

  async function submitOverride(id: string) {
    if (!overrideCategoryId) return;
    setConfirmingId(id);
    try {
      const res = await fetch(`/api/insights/categorizations/${id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: overrideCategoryId }),
      });
      if (res.ok) {
        setItems((curr) => curr.filter((i) => i.id !== id));
        setOverridingId(null);
        setOverrideCategoryId("");
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to update category");
      }
    } finally {
      setConfirmingId(null);
    }
  }

  const openItems = useMemo(() => items, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[#0B1E3F]">Insights</h1>
          <p className="text-sm text-[#7C8CA6] mt-1">
            Review and confirm categorizations the AI flagged as uncertain.
          </p>
        </div>
        {!loading && openItems.length > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
            {openItems.length} to review
          </span>
        )}
      </div>

      <InsightsSubNav active="categorize" />

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#7C8CA6]">Loading…</p>
      ) : openItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-12 text-center space-y-2">
          <h2 className="text-sm font-semibold text-[#0B1E3F]">Nothing to review</h2>
          <p className="text-sm text-[#7C8CA6] max-w-md mx-auto">
            All categorizations are confirmed. As new transactions arrive, anything below the
            confidence threshold will show up here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {openItems.map((item) => {
            const tx = item.onchainTransaction;
            const isOverriding = overridingId === item.id;
            const isBusy = confirmingId === item.id;
            return (
              <div key={item.id} className="px-4 md:px-5 py-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className={`text-sm font-semibold ${
                          tx.direction === "IN" ? "text-emerald-700" : "text-[#0B1E3F]"
                        }`}
                      >
                        {tx.direction === "IN" ? "+" : "-"}
                        {formatMoney(tx.amount)}
                      </span>
                      <span className="text-xs text-[#7C8CA6]">{formatDate(tx.createdAt)}</span>
                      <span className="text-xs text-[#7C8CA6]">·</span>
                      <span className="text-xs text-[#7C8CA6]">
                        {confidenceLabel(item.confidenceBps, item.source)}
                      </span>
                    </div>
                    <p className="text-sm text-[#0B1E3F] truncate">
                      {tx.counterpartyDisplayName ?? "No counterparty"}
                    </p>
                    {tx.memo && (
                      <p className="text-xs text-[#7C8CA6] truncate mt-0.5">{tx.memo}</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#E5E9F2] bg-[#F9FBFF] px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-xs font-semibold text-[#3E4A6B]">
                        {item.source === "RULE" ? "Suggested category" : "AI suggestion"}
                      </p>
                      <p className="text-sm text-[#0B1E3F] font-medium mt-0.5">
                        {item.llmSuggestedCategoryName ?? item.category.name}
                      </p>
                    </div>
                  </div>
                  {item.llmReasoning && (
                    <p className="text-xs text-[#7C8CA6] leading-relaxed pt-1 border-t border-[#E5E9F2]">
                      Reasoning: {item.llmReasoning}
                    </p>
                  )}
                </div>

                {isOverriding ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={overrideCategoryId}
                      onChange={(e) => setOverrideCategoryId(e.target.value)}
                      className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] bg-white"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={isBusy || !overrideCategoryId}
                      onClick={() => submitOverride(item.id)}
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
                      {isBusy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelOverride}
                      className="btn-3d btn-3d--sm btn-3d--neutral"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleConfirm(item.id)}
                      className="btn-3d btn-3d--sm"
                      style={
                        {
                          "--btn-bg": "#0B8F5A",
                          "--btn-bg-hover": "#0A7A4D",
                          "--btn-edge": "#065738",
                          "--btn-edge-hover": "#054A2F",
                          color: "#ffffff",
                        } as React.CSSProperties
                      }
                    >
                      {isBusy ? "Confirming…" : "Looks right"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => startOverride(item)}
                      className="btn-3d btn-3d--sm btn-3d--neutral"
                    >
                      Change category
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
