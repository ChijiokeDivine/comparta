// app/(app)/insights/page.tsx
"use client";

import { useEffect, useState } from "react";
import InsightsSubNav from "./_components/InsightsSubNav";
import { formatMoney } from "@/app/invoices/_components/format";

interface SpendSlice {
  categoryId: string;
  categoryName: string;
  totalAmount: string;
  transactionCount: number;
}
interface TrendPoint {
  bucketStart: string;
  inflow: string;
  outflow: string;
  net: string;
}
interface OverviewData {
  spendByCategory: {
    slices: SpendSlice[];
    uncategorizedAmount: string;
    uncategorizedCount: number;
  };
  trend: TrendPoint[];
}

interface NlQueryTransaction {
  id: string;
  direction: "IN" | "OUT";
  amount: string;
  counterpartyDisplayName: string;
  memo: string | null;
  categoryName: string | null;
  createdAt: string;
}
interface NlQueryResponse {
  question: string;
  transactions: NlQueryTransaction[];
  totalAmount: string;
  totalCount: number;
}

const PRESETS = [
  { value: "trailing_30_days", label: "Last 30 days" },
  { value: "trailing_90_days", label: "Last 90 days" },
  { value: "current_month", label: "This month" },
] as const;

export default function InsightsOverviewPage() {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["value"]>("trailing_30_days");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [queryResult, setQueryResult] = useState<NlQueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/insights/overview?preset=${preset}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Failed to load insights");
          return;
        }
        setData(body);
      })
      .catch(() => setError("Failed to load insights"))
      .finally(() => setLoading(false));
  }, [preset]);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setQueryError(null);
    setAsking(true);
    try {
      const res = await fetch("/api/insights/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setQueryError(body.error ?? "Couldn't answer that question");
        return;
      }
      setQueryResult(body);
    } catch {
      setQueryError("Couldn't answer that question");
    } finally {
      setAsking(false);
    }
  }

  const maxSpend = data ? Math.max(...data.spendByCategory.slices.map((s) => Number(s.totalAmount)), 1) : 1;
  const maxTrend = data
    ? Math.max(...data.trend.flatMap((p) => [Number(p.inflow), Number(p.outflow)]), 1)
    : 1;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Insights</h1>
      <InsightsSubNav active="overview" />

      <form onSubmit={handleAsk} className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-3">
        <label htmlFor="question" className="block text-sm font-semibold text-[#0B1E3F]">
          Ask a question about your transactions
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. payments to Sarah over $500 last quarter"
            className="flex-1 min-w-[200px] px-4 py-2.5 rounded-xl border border-[#E5E9F2] text-sm text-[#0B1E3F] focus:border-[#2A5CE6]"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
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
            {asking ? "Asking…" : "Ask"}
          </button>
        </div>

        {queryError && <p className="text-sm text-red-600">{queryError}</p>}

        {queryResult && (
          <div className="pt-3 border-t border-[#F2F4F8] space-y-3">
            <p className="text-sm text-[#3E4A6B]">
              Found <span className="font-semibold">{queryResult.totalCount}</span> transaction
              {queryResult.totalCount === 1 ? "" : "s"} totaling{" "}
              <span className="font-semibold">{formatMoney(queryResult.totalAmount)}</span>
            </p>
            {queryResult.transactions.length > 0 && (
              <div className="rounded-xl border border-[#E5E9F2] divide-y divide-[#F2F4F8]">
                {queryResult.transactions.slice(0, 10).map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-[#0B1E3F] truncate">{tx.counterpartyDisplayName}</p>
                      <p className="text-xs text-[#7C8CA6]">{tx.categoryName ?? "Uncategorized"}</p>
                    </div>
                    <span className="text-[#0B1E3F] font-medium tabular-nums shrink-0">
                      {formatMoney(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </form>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              preset === p.value
                ? "bg-[#0B1E3F] text-white border-[#0B1E3F]"
                : "bg-white text-[#3E4A6B] border-[#E5E9F2] hover:border-[#2A5CE6]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-[#7C8CA6]">Loading…</p>
      ) : data ? (
        <>
          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#0B1E3F] mb-4">Spend by category</h2>
            {data.spendByCategory.slices.length === 0 ? (
              <p className="text-sm text-[#7C8CA6]">No spend in this range yet.</p>
            ) : (
              <div className="space-y-3">
                {data.spendByCategory.slices.map((slice) => (
                  <div key={slice.categoryId}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-[#0B1E3F] font-medium">{slice.categoryName}</span>
                      <span className="text-[#0B1E3F] tabular-nums">{formatMoney(slice.totalAmount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#F2F4F8] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#2A5CE6]"
                        style={{ width: `${(Number(slice.totalAmount) / maxSpend) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                {Number(data.spendByCategory.uncategorizedAmount) > 0 && (
                  <p className="text-xs text-[#7C8CA6] pt-1">
                    {formatMoney(data.spendByCategory.uncategorizedAmount)} uncategorized (
                    {data.spendByCategory.uncategorizedCount} transactions)
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#0B1E3F] mb-4">Inflow vs outflow</h2>
            {data.trend.length === 0 ? (
              <p className="text-sm text-[#7C8CA6]">No activity in this range yet.</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {data.trend.map((point) => (
                  <div key={point.bucketStart} className="flex-1 flex items-end gap-0.5" title={point.bucketStart}>
                    <div
                      className="flex-1 bg-emerald-200 rounded-sm"
                      style={{ height: `${Math.max((Number(point.inflow) / maxTrend) * 100, 2)}%` }}
                    />
                    <div
                      className="flex-1 bg-[#DDE5FB] rounded-sm"
                      style={{ height: `${Math.max((Number(point.outflow) / maxTrend) * 100, 2)}%` }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-4 mt-3 text-xs text-[#7C8CA6]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200" /> Inflow
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#DDE5FB]" /> Outflow
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}