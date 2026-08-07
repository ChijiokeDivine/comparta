// app/(app)/insights/anomalies/page.tsx
"use client";

import { useEffect, useState } from "react";
import InsightsSubNav from "../_components/InsightsSubNav";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";

interface Anomaly {
  id: string;
  type: "LARGE_OUTFLOW" | "NEW_COUNTERPARTY_LARGE_PAYMENT";
  status: "OPEN" | "DISMISSED";
  message: string;
  transactionAmount: string;
  createdAt: string;
}

const TYPE_LABEL: Record<Anomaly["type"], string> = {
  LARGE_OUTFLOW: "Unusually large outflow",
  NEW_COUNTERPARTY_LARGE_PAYMENT: "Large payment to a new counterparty",
};

export default function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDismissed]);

  function load() {
    setLoading(true);
    const params = showDismissed ? "" : "?status=OPEN";
    fetch(`/api/insights/anomalies${params}`)
      .then((res) => res.json())
      .then((data) => setAnomalies(data.anomalies ?? []))
      .catch(() => setError("Failed to load anomalies"))
      .finally(() => setLoading(false));
  }

  async function handleDismiss(id: string) {
    setDismissing(id);
    try {
      const res = await fetch(`/api/insights/anomalies/${id}/dismiss`, { method: "POST" });
      if (res.ok) load();
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Insights</h1>
      <InsightsSubNav active="anomalies" />

      <label className="flex items-center gap-2 text-sm text-[#3E4A6B]">
        <input
          type="checkbox"
          checked={showDismissed}
          onChange={(e) => setShowDismissed(e.target.checked)}
          className="w-4 h-4"
        />
        Show dismissed
      </label>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && anomalies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          Nothing worth a second look right now.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {anomalies.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-700 mb-1">{TYPE_LABEL[a.type]}</p>
                <p className="text-sm text-[#0B1E3F]">{a.message}</p>
                <p className="text-xs text-[#7C8CA6] mt-1">
                  {formatMoney(a.transactionAmount)} · {formatDate(a.createdAt)}
                </p>
              </div>
              {a.status === "OPEN" && (
                <button
                  onClick={() => handleDismiss(a.id)}
                  disabled={dismissing === a.id}
                  className="btn-3d btn-3d--sm btn-3d--neutral shrink-0"
                >
                  {dismissing === a.id ? "Dismissing…" : "Dismiss"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}