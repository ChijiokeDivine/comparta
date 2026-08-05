// app/(app)/dashboard/_components/KpiCards.tsx
import Link from "next/link";
import type { DashboardKpis } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney } from "@/app/invoices/_components/format";

export default function KpiCards({ kpis }: { kpis: DashboardKpis }) {
  const pendingTotal = kpis.pendingPayrollApprovals + kpis.overdueInvoices;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Stat label="30-day inflow" value={formatMoney(kpis.inflow30d)} tone="emerald" />
      <Stat label="30-day outflow" value={formatMoney(kpis.outflow30d)} tone="neutral" />
      <Stat
        label="Yield accrued"
        value={formatMoney(kpis.netYieldAccrued)}
        tone="emerald"
        hint={kpis.yieldDataStale ? "Live NAV unavailable — showing cost basis" : undefined}
      />
      <Link href={pendingTotal > 0 ? "/payroll" : "#"} className="block">
        <Stat
          label="Pending approvals"
          value={String(pendingTotal)}
          tone={pendingTotal > 0 ? "amber" : "neutral"}
          hint={
            pendingTotal > 0
              ? `${kpis.pendingPayrollApprovals} payroll · ${kpis.overdueInvoices} overdue`
              : "All clear"
          }
        />
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "neutral";
  hint?: string;
}) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-[#0B1E3F]";

  return (
    <div className="rounded-2xl border border-[#E5E9F2] bg-white p-4">
      <p className="text-xs font-medium text-[#7C8CA6] mb-1.5">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="text-xs text-[#7C8CA6] mt-1">{hint}</p>}
    </div>
  );
}