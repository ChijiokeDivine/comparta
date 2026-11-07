"use client";

import Link from "next/link";
import type { DashboardKpis } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney } from "@/app/invoices/_components/format";
import {
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import Image from "next/image";
import { useHideBalances, maskBalance } from "@/app/(app)/_components/HideBalancesProvider"; 

export default function KpiCards({
  kpis,
}: {
  kpis: DashboardKpis;
}) {
  const { hideBalances } = useHideBalances();
  const pendingTotal =
    kpis.pendingPayrollApprovals + kpis.overdueInvoices;
  const inflow = Number(kpis.inflow30d);
  const outflow = Number(kpis.outflow30d);

  const netCashflow = inflow - outflow;

  return (
    <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-row justify-between items-baseline w-full">
          <h3 className="md:text-md text-md font-medium text-[#0B1E3F]">
            Financial Summary
          </h3>
          <p className="md:text-xs text-xs text-[#7C8CA6] mt-1">
            Last 30 days
          </p>

          
        </div>
      </div>

      <div className="space-y-6">
        {/* Cash Flow */}
        <section>
          <p className="md:text-sm text-xs text-[#7C8CA6]">
            Net Cash Flow
          </p>

          <h2
            className={`mt-1 md:text-xl text-lg font-semibold tabular-nums inline-flex items-center gap-1.5 ${
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
            {maskBalance(formatMoney(netCashflow.toString()), hideBalances)}
          </h2>
          

          <div className="mt-4 flex gap-6 text-xs">
            <div className="flex items-center gap-2 text-emerald-600">
              <ArrowUpRight size={18} />
              <span>{maskBalance(formatMoney(kpis.inflow30d), hideBalances)}</span>
            </div>

            <div className="flex items-center gap-2 text-red-500">
              <ArrowDownRight size={18} />
              <span>{maskBalance(formatMoney(kpis.outflow30d), hideBalances)}</span>
            </div>
          </div>
          
        </section>
      </div>

      <div className="mt-auto pt-6">
        <div className="border-t border-[#EEF2F7]" />

        {/* Pending actions */}
        <section className="flex items-center justify-between mt-6">
          <div>
            <p className="md:text-sm text-xs text-[#7C8CA6]">
              Pending Actions
            </p>

            <h3 className="mt-1 md:text-xl text-lg font-semibold text-[#0B1E3F]">
              {pendingTotal}
            </h3>

            <p className="mt-1 text-xs text-[#7C8CA6]">
              {pendingTotal > 0
                ? `${kpis.pendingPayrollApprovals} payroll · ${kpis.overdueInvoices} invoices`
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
        </section>
      </div>
    </div>
  );
}