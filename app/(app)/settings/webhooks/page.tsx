// app/(app)/settings/webhooks/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
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

interface PajWebhookDiagnostics {
  target: {
    url: string | null;
    source: "env" | "derived" | "none";
    public: boolean;
    reason: string | null;
  };
  autoRegister: boolean;
  secret: {
    source: "env" | "stored" | "missing";
    hint: string | null;
    matchesProvider: boolean | null;
    error: string | null;
  };
  registration: {
    url: string | null;
    registeredAt: string | null;
    matchesTarget: boolean;
  };
  events: {
    last24h: number;
    failed24h: number;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: string | null;
  };
}

function secretLabel(diagnostics: PajWebhookDiagnostics): string {
  const { secret } = diagnostics;
  if (secret.source === "env") return "PAJ_CASH_WEBHOOK_SECRET";
  if (secret.source === "stored") return "Stored from Paj";
  return "Not configured";
}

export default function WebhookEventsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [resultById, setResultById] = useState<Record<string, string>>({});

  const [paj, setPaj] = useState<PajWebhookDiagnostics | null>(null);
  const [pajAction, setPajAction] = useState<"register" | "test" | null>(null);
  const [pajMessage, setPajMessage] = useState<string | null>(null);
  const [pajError, setPajError] = useState<string | null>(null);

  // Manual re-fetch, used after a reprocess action. Called from an event
  // handler, not an effect body, so a synchronous setLoading(true) here is
  // exactly the pattern React expects.
  const refetch = useCallback(() => {
    setLoading(true);
    fetch("/api/org/webhook-events")
      .then((res) => res.json())
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setError("Failed to load webhook events"))
      .finally(() => setLoading(false));
  }, []);

  // Fetch-on-mount / on-isOwner-change. Kept inline (rather than calling a
  // shared `load` helper) so eslint can see the setState calls belong to
  // this effect and a `cancelled` guard can protect against a stale
  // response landing after isOwner changes or the component unmounts.
  useEffect(() => {
    if (!isOwner) return; // loading already starts true; nothing to fetch, nothing to reset here

    let cancelled = false;

    Promise.all([
      fetch("/api/org/webhook-events").then((res) => res.json()),
      fetch("/api/paj/webhook").then(async (res) => ({
        ok: res.ok,
        body: await res.json().catch(() => null),
      })),
    ])
      .then(([eventsData, pajRes]) => {
        if (cancelled) return;
        setEvents(eventsData.events ?? []);
        if (pajRes.ok && pajRes.body) {
          setPaj(pajRes.body as PajWebhookDiagnostics);
        } else {
          setError(
            "Paj webhook status is unavailable. If this deployment is new, run the latest database migration."
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load webhook events");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOwner]);

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
      setResultById((prev) => ({
        ...prev,
        [id]: data.result?.changed
          ? "Reprocessed. The order moved to its latest status."
          : "Reprocessed. Nothing new to apply.",
      }));
      refetch();
    } catch {
      setResultById((prev) => ({ ...prev, [id]: "Reprocessing failed" }));
    } finally {
      setReprocessingId(null);
    }
  }

  async function runPajAction(action: "register" | "test") {
    setPajAction(action);
    setPajMessage(null);
    setPajError(null);
    try {
      const res = await fetch("/api/paj/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPajError(data?.error ?? "That didn't work. Try again.");
        return;
      }
      if (data?.diagnostics) setPaj(data.diagnostics as PajWebhookDiagnostics);

      if (action === "register") {
        const hint = data?.registration?.secretHint;
        if (data?.registration?.secretSource === "missing") {
          setPajError(
            "URL connected, but Paj returned no signing secret. Deliveries would be stored as unverified — reconnect, or set PAJ_CASH_WEBHOOK_SECRET."
          );
        } else {
          setPajMessage(
            hint
              ? `Payout updates are now signed and verified (secret …${hint}).`
              : "Webhook URL registered with Paj."
          );
        }
      } else {
        const result = data?.result as
          | { delivered: boolean; durationMs: number; error?: string }
          | undefined;
        if (result?.delivered) {
          setPajMessage(`Test delivery accepted by this endpoint in ${result.durationMs}ms.`);
        } else {
          setPajError(
            `Paj couldn't deliver the test: ${result?.error ?? "unknown error"}. Check the URL is public https and does not redirect.`
          );
        }
      }
      refetch();
    } catch {
      setPajError("That didn't work. Try again.");
    } finally {
      setPajAction(null);
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
          Recent deliveries from Circle and Paj. If a deposit shows in your onchain balance but never
          reached a bucket, look for its <code className="font-mono">transactions.inbound</code> event
          below — if it arrived at the wrong endpoint (source{" "}
          <code className="font-mono">circle-payments</code> instead of{" "}
          <code className="font-mono">circle</code>) or otherwise didn&apos;t credit anything, reprocess
          it here. Bank transfers can be reprocessed the same way.
        </p>
      </div>

      {paj && (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white px-5 py-4 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-[#0B1E3F]">Paj bank transfers</h3>
              <p className="text-xs text-[#7C8CA6]">
                Status updates for bank deposits and payouts.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {paj.registration.matchesTarget ? (
                <StatusPill value="CONFIRMED" label="Connected" />
              ) : (
                <StatusPill value="INIT" label="Not connected" />
              )}
              {paj.events.failed24h > 0 && (
                <StatusPill
                  value="FAILED"
                  label={`${paj.events.failed24h} failed 24h`}
                />
              )}
            </div>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-[#7C8CA6]">Endpoint</dt>
              <dd className="text-sm text-[#0B1E3F] font-mono break-all">
                {paj.target.url ?? "Not configured"}
              </dd>
              {!paj.target.public && paj.target.reason && (
                <p className="text-xs text-amber-700 mt-1">{paj.target.reason}</p>
              )}
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-[#7C8CA6]">Signing secret</dt>
              <dd className="text-sm text-[#0B1E3F]">
                {secretLabel(paj)}
                {paj.secret.hint && (
                  <span className="text-[#7C8CA6] font-mono"> ····{paj.secret.hint}</span>
                )}
              </dd>
              {paj.secret.matchesProvider === false && (
                <p className="text-xs text-amber-700 mt-1">
                  This doesn&apos;t match the secret Paj has for this key, so real deliveries will be
                  rejected. Clear PAJ_CASH_WEBHOOK_SECRET and reconnect.
                </p>
              )}
              {paj.secret.error && paj.secret.source === "missing" && (
                <p className="text-xs text-[#7C8CA6] mt-1">{paj.secret.error}</p>
              )}
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[#7C8CA6]">Last delivery</dt>
              <dd className="text-sm text-[#0B1E3F]">
                {paj.events.lastDeliveryAt
                  ? `${formatDate(paj.events.lastDeliveryAt)}${paj.events.lastDeliveryStatus ? ` · ${paj.events.lastDeliveryStatus}` : ""}`
                  : "None yet"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[#7C8CA6]">Last 24 hours</dt>
              <dd className="text-sm text-[#0B1E3F]">
                {paj.events.last24h} received
                {paj.events.failed24h > 0 ? ` · ${paj.events.failed24h} failed` : ""}
              </dd>
            </div>
          </dl>

          {paj.registration.url && !paj.registration.matchesTarget && (
            <p className="text-xs text-amber-700">
              Paj is currently pointed at <span className="font-mono">{paj.registration.url}</span>,
              not this deployment. Reconnect to move it.
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <button
              onClick={() => runPajAction("register")}
              disabled={pajAction !== null || !paj.target.public}
              className="btn-3d btn-3d--sm"
            >
              {pajAction === "register"
                ? "Connecting…"
                : paj.registration.matchesTarget
                  ? "Reconnect"
                  : "Connect webhook"}
            </button>
            <button
              onClick={() => runPajAction("test")}
              disabled={pajAction !== null || !paj.registration.url}
              className="btn-3d btn-3d--sm btn-3d--neutral"
            >
              {pajAction === "test" ? "Sending…" : "Send test delivery"}
            </button>
            {pajMessage && <span className="text-xs text-emerald-700">{pajMessage}</span>}
            {pajError && <span className="text-xs text-red-600">{pajError}</span>}
          </div>

          <p className="text-[11px] text-[#7C8CA6]">
            Connecting points Paj&apos;s ramp webhook at this deployment and stores the signing secret
            it returns. The test posts a signed sample order — a green result proves this endpoint
            verifies real deliveries.
          </p>
        </div>
      )}

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

              {(ev.eventType === "transactions.inbound" || ev.source === "paj") && (
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
