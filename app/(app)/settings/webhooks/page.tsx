// app/(app)/settings/webhooks/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import SettingsSubNav from "../_components/SettingsSubNav";
import { StatusPill } from "@/app/components/StatusPill";
import { formatDate } from "@/app/invoices/_components/format";

interface WebhookEvent {
  id: string;
  source: string;
  eventType: string | null;
  signatureOk: boolean;
  status: "RECEIVED" | "PROCESSED" | "FAILED";
  processError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export default function WebhookEventsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [resultById, setResultById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOwner) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  function load() {
    setLoading(true);
    fetch("/api/org/webhook-events")
      .then((res) => res.json())
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setError("Failed to load webhook events"))
      .finally(() => setLoading(false));
  }

  async function handleReprocess(id: string) {
    setReprocessingId(id);
    setResultById((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/org/webhook-events/${id}/reprocess`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResultById((prev) => ({ ...prev, [id]: data.error ?? "Reprocessing failed" }));
        return;
      }
      setResultById((prev) => ({ ...prev, [id]: "Reprocessed. Check the bucket balance." }));
      load();
    } catch {
      setResultById((prev) => ({ ...prev, [id]: "Reprocessing failed" }));
    } finally {
      setReprocessingId(null);
    }
  }

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Settings</h1>
        <SettingsSubNav active="organization" />
        <p className="text-sm text-[#7C8CA6]">Only an OWNER can view webhook diagnostics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Settings</h1>
      <SettingsSubNav active="organization" />

      <div>
        <h2 className="text-sm font-semibold text-[#0B1E3F] mb-1">Webhook events</h2>
        <p className="text-xs text-[#7C8CA6] mb-4">
          Recent Circle webhook deliveries. If a deposit shows in your onchain balance but never reached a
          bucket, look for its <code className="font-mono">transactions.inbound</code> event below — if it
          arrived at the wrong endpoint (source <code className="font-mono">circle-payments</code> instead of{" "}
          <code className="font-mono">circle</code>) or otherwise didn&apos;t credit anything, reprocess it here.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No webhook events recorded yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {events.map((ev) => (
            <div key={ev.id} className="px-5 py-4 space-y-2">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#0B1E3F]">
                    {ev.eventType ?? "unknown type"}{" "}
                    <span className="text-xs font-mono text-[#7C8CA6]">via {ev.source}</span>
                  </p>
                  <p className="text-xs text-[#7C8CA6]">
                    Received {formatDate(ev.createdAt)}
                    {ev.processedAt && <> · processed {formatDate(ev.processedAt)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!ev.signatureOk && <StatusPill value="FAILED" label="Signature failed" />}
                  <StatusPill value={ev.status} />
                </div>
              </div>

              {ev.processError && <p className="text-xs text-red-600">{ev.processError}</p>}

              {ev.eventType === "transactions.inbound" && (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => handleReprocess(ev.id)}
                    disabled={reprocessingId === ev.id}
                    className="btn-3d btn-3d--sm btn-3d--neutral"
                  >
                    {reprocessingId === ev.id ? "Reprocessing…" : "Reprocess"}
                  </button>
                  {resultById[ev.id] && <span className="text-xs text-[#7C8CA6]">{resultById[ev.id]}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}