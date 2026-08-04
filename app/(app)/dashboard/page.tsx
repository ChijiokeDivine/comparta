// app/(app)/dashboard/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getDashboardSummary } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney } from "@/app/invoices/_components/format";
import { KybBanner } from "../_components/Kyb";
import QuickActions from "./_components/QuickActions";
import BucketCards from "./_components/BucketCards";
import KpiCards from "./_components/KpiCards";
import ActivityFeed from "./_components/ActivityFeed";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const org = await prisma.organization.findUnique({
    where: { id: session.user.orgId },
    select: { kybStatus: true },
  });
  if (!org) redirect("/login");

  const { kpis, buckets, activity } = await getDashboardSummary(session.user.orgId);
  const financialActionsDisabled = org.kybStatus !== "APPROVED";

  return (
    <div className="space-y-6">
      <KybBanner status={org.kybStatus} />

      {/* Balance hero */}
      <div>
        <p className="text-sm font-medium text-[#7C8CA6] mb-1">Total balance</p>
        <p className="text-3xl sm:text-4xl font-semibold text-[#0B1E3F] tabular-nums">
          {formatMoney(kpis.totalBalance)}
        </p>
        <p className="text-sm text-[#7C8CA6] mt-1">
          {formatMoney(kpis.liquidBalance)} liquid · {formatMoney(kpis.deployedBalance)} in savings
        </p>
      </div>

      <QuickActions disabled={financialActionsDisabled} />

      <KpiCards kpis={kpis} />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#0B1E3F]">Buckets</h2>
          <Link href="/buckets" className="text-sm font-medium text-[#2A5CE6] hover:underline">
            See all
          </Link>
        </div>
        <BucketCards buckets={buckets} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#0B1E3F]">Recent activity</h2>
          <Link href="/wallet/transfers" className="text-sm font-medium text-[#2A5CE6] hover:underline">
            See all
          </Link>
        </div>
        <ActivityFeed items={activity} />
      </div>
    </div>
  );
}