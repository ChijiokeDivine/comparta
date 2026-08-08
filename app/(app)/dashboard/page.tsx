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
import MaskedTotalBalance from "./_components/MaskedTotalBalance";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

function formatBalanceHero(decimalString: string): string {
  const [rawWhole, rawFrac = ""] = decimalString.split(".");
  const whole = rawWhole || "0";

  const trimmedFrac = rawFrac.replace(/0+$/, "");
  if (!trimmedFrac) return `${whole}.00`;

  const MIN_FRAC = 2;
  const displayFrac =
    trimmedFrac.length < MIN_FRAC
      ? trimmedFrac.padEnd(MIN_FRAC, "0")
      : trimmedFrac;

  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${wholeGrouped}.${displayFrac}`;
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const [org, wallet] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.user.orgId },
      select: { kybStatus: true },
    }),
    prisma.wallet.findFirst({
      where: { orgId: session.user.orgId },
      select: { arcAddress: true, chain: true },
    }),
  ]);
  if (!org) redirect("/login");

  const { kpis, buckets, activity } = await getDashboardSummary(session.user.orgId);
  const financialActionsDisabled = org.kybStatus !== "APPROVED";

  return (
    <div className="space-y-6">
      <KybBanner status={org.kybStatus} />

      {/* Balance hero */}
      <div className="md:mt-5">
        <p className="text-sm font-medium text-[#7C8CA6] mb-1">Total balance</p>
        <MaskedTotalBalance formatted={formatBalanceHero(kpis.totalBalance)} />
        {/* <p className="text-sm text-[#7C8CA6] mt-1">
          {formatMoney(kpis.liquidBalance)} liquid · {formatMoney(kpis.deployedBalance)} in savings
        </p> */}
      </div>

      <QuickActions disabled={financialActionsDisabled} wallet={wallet} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <KpiCards kpis={kpis} />


          
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
