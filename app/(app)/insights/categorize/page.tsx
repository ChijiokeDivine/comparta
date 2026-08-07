// app/(app)/insights/categorize/page.tsx
"use client";

import { useEffect, useState } from "react";
import InsightsSubNav from "../_components/InsightsSubNav";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface Category {
  id: string;
  name: string;
}

interface PendingItem {
  id: string;
  llmSuggestedCategoryName: string | null;
  llmReasoning: string | null;
  confidenceBps: number | null;
  category: { id: string; name: string };
  onchainTransaction: {
    id: string;
    amount: string;
    counterpartyAddress: string;
    createdAt: string;
  };
}

export default function CategorizePage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overridingId, setOverridingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/insights/categorizations/pending").then((res) => res.json()),
      fetch("/api/insights/categories").then((res) => res.json()),
    ])
      .then(([pendingData, categoriesData]) => {
        setItems(pendingData.categorizations ?? []);
        setCategories(categoriesData.categories ?? []);
      })
      .catch(() => setError("Failed to load pending categorizations"))
      .finally(() => setLoading(false));
  }

  async function handleConfirm(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/insights/categorizations/${id}/confirm`, { method: "POST" });
      if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function handleOverride(id: string, categoryId: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/insights/categorizations/${id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setBusyId(null);
      setOverridingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Insights</h1>
      <InsightsSubNav active="categorize" />

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          Nothing needs review right now.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {items.map((item) => (
            <div key={item.id} className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#0B1E3F] font-mono truncate">
                    {item.onchainTransaction.counterpartyAddress}
                  </p>
                  <p className="text-xs text-[#7C8CA6]">{formatDate(item.onchainTransaction.createdAt)}</p>
                </div>
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums shrink-0">
                  {formatMoney(item.onchainTransaction.amount)}
                </span>
              </div>

              <div className="rounded-xl bg-[#F7F8FB] p-3 text-sm">
                <p className="text-[#0B1E3F]">
                  Suggested: <span className="font-semibold">{item.category.name}</span>
                  {item.confidenceBps !== null && (
                    <span className="text-[#7C8CA6]"> · {Math.round(item.confidenceBps / 100)}% confidence</span>
                  )}
                </p>
                {item.llmReasoning && <p className="text-xs text-[#7C8CA6] mt-1">{item.llmReasoning}</p>}
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  onClick={() => handleConfirm(item.id)}
                  disabled={busyId === item.id}
                  className="btn-3d btn-3d--sm"
                  style={
                    {
                      "--btn-bg": "#059669",
                      "--btn-bg-hover": "#047857",
                      "--btn-edge": "#065f46",
                      "--btn-edge-hover": "#064e3b",
                      color: "#ffffff",
                    } as React.CSSProperties
                  }
                >
                  {busyId === item.id ? "Saving…" : "Confirm"}
                </button>

                {overridingId === item.id ? (
                  <select
                    autoFocus
                    onChange={(e) => e.target.value && handleOverride(item.id, e.target.value)}
                    onBlur={() => setOverridingId(null)}
                    disabled={busyId === item.id}
                    defaultValue=""
                    className="px-3 py-2 rounded-lg border border-[#E5E9F2] text-sm text-[#0B1E3F]"
                  >
                    <option value="" disabled>
                      Choose a category…
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    onClick={() => setOverridingId(item.id)}
                    disabled={busyId === item.id}
                    className="btn-3d btn-3d--sm btn-3d--neutral"
                  >
                    Change category
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}