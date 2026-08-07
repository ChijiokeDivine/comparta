// app/(app)/dashboard/_components/KpiCards.tsx

import Link from "next/link";
import type { DashboardKpis } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney } from "@/app/invoices/_components/format";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import Image from "next/image"; 

export default function KpiCards({
  kpis,
}: {
  kpis: DashboardKpis;
}) {
  const pendingTotal =
    kpis.pendingPayrollApprovals + kpis.overdueInvoices;
  const inflow = Number(kpis.inflow30d);
  const outflow = Number(kpis.outflow30d);

  const netCashflow = inflow - outflow;

  return (
    <div className="rounded-3xl border border-[#E5E9F2] bg-white p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-row justify-between items-baseline w-full">
          <h3 className="text-lg font-medium text-[#0B1E3F]">
            Financial Summary
          </h3>
          <p className="text-sm text-[#7C8CA6] mt-1">
            Last 30 days
          </p>

          
        </div>
      </div>

      <div className="space-y-6">
        {/* Cash Flow */}
        <section>
          <p className="text-sm text-[#7C8CA6]">
            Net Cash Flow
          </p>

          <h2
            className={`mt-1 text-2xl font-semibold tabular-nums inline-flex items-center gap-1.5 ${
              netCashflow > 0
                ? "text-emerald-600"
                : netCashflow === 0
                  ? "text-[#0B1E3F]"
                  : "text-red-600"
            }`}
          >
            {netCashflow > 0 ? "+" : ""}
            <Image
              src="/usdc.png"
              alt="USDC"
              width={22}
              height={22}
              className="rounded-3xl shrink-0"
            />
            {formatMoney(netCashflow.toString())}
          </h2>
          

          <div className="mt-4 flex gap-6 text-sm">
            <div className="flex items-center gap-2 text-emerald-600">
              <ArrowUpRight size={18} />
              <span>{formatMoney(kpis.inflow30d)}</span>
            </div>

            <div className="flex items-center gap-2 text-red-500">
              <ArrowDownRight size={18} />
              <span>{formatMoney(kpis.outflow30d)}</span>
            </div>
          </div>
          
        </section>
      </div>

      <div className="mt-auto pt-6">
        <div className="border-t border-[#EEF2F7]" />

        {/* Yield */}
        <section className="flex justify-between items-end mt-6">
          <div>
            <p className="text-sm text-[#7C8CA6]">
              Yield Earned
            </p>

            <p className="mt-1 text-2xl font-semibold text-[#0B1E3F] tabular-nums inline-flex items-center gap-1.5">
              <Image
                src="/usdc.png"
                alt="USDC"
                width={22}
                height={22}
                className="rounded-3xl shrink-0"
              />
              {formatMoney(kpis.netYieldAccrued)}
            </p>
          </div>

          <div className="group relative">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium cursor-help ${
                kpis.yieldDataStale
                  ? "bg-amber-50 text-amber-700"
                  : " text-black"
              }`}
            >
              {kpis.yieldDataStale ? (
                <>
                  <Clock3 size={14} />
                  Cost basis
                </>
              ) : (
                <>
                  
                  Live Valuation
                </>
              )}
            </div>
            <div className="pointer-events-none absolute right-0 bottom-full mb-2 w-64 rounded-xl border border-[#E5E9F2] bg-white/90 backdrop-blur-md p-3 text-xs leading-relaxed text-[#0B1E3F] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 z-20">
              {kpis.yieldDataStale
                ? "Live market prices are currently unavailable. Yield is shown at the original purchase price of your assets (cost basis) and may differ from today's actual market value."
                : "Uses the latest available market prices to calculate the current value of your assets and accrued yield."}
            </div>
          </div>
        </section>

        {/* <div className="border-t border-[#EEF2F7]" /> */}

        {/* Pending */}
        {/* <section className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#7C8CA6]">
              Pending Actions
            </p>

            <h3 className="mt-1 text-2xl font-semibold text-[#0B1E3F]">
              {pendingTotal}
            </h3>

            <p className="mt-1 text-sm text-[#7C8CA6]">
              {pendingTotal > 0
                ? `${kpis.pendingPayrollApprovals} payroll • ${kpis.overdueInvoices} invoices`
                : "Everything is up to date"}
            </p> 
          </div>

          {pendingTotal > 0 && (
            <Link
              href="/payroll"
              className="rounded-full bg-[#EEF4FF] px-4 py-2 text-sm font-medium text-[#2A5CE6] hover:bg-[#E3ECFF] transition-colors"
            >
              Review
            </Link>
          )}
        </section> */}
      </div>
    </div>
  );
}