// app/(app)/_components/Kyb.tsx
//
// Small presentational pieces for surfacing Organization.kybStatus. Kept
// deliberately dumb (no fetching) — callers pass the status down from a
// server-fetched org record so there's one source of truth per page load.

import type { KybStatus } from "@/app/generated/prisma/client";

const PILL_STYLES: Record<KybStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
};

const PILL_LABEL: Record<KybStatus, string> = {
  PENDING: "KYB pending",
  APPROVED: "KYB approved",
  REJECTED: "KYB rejected",
};

export function KybPill({ status }: { status: KybStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${PILL_STYLES[status]}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {PILL_LABEL[status]}
    </span>
  );
}

/**
 * Sticky banner for financial pages. Per the KYB gate spec: PENDING and
 * REJECTED both disable financial CTAs elsewhere on the page — this banner
 * is the visible half of that gate. Not shown at all when APPROVED.
 */
export function KybBanner({ status }: { status: KybStatus }) {
  if (status === "APPROVED") return null;

  const isPending = status === "PENDING";

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm flex items-center gap-3 ${
        isPending
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-red-50 border-red-200 text-red-800"
      }`}
    >
      <span className="w-2 h-2 rounded-full bg-current shrink-0" />
      {isPending ? (
        <span>We&apos;re reviewing your organization. Most actions are disabled until approved.</span>
      ) : (
        <span>Your KYB was rejected. Contact support.</span>
      )}
    </div>
  );
}