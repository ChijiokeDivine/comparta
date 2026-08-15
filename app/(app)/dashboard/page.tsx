// app/(app)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getDashboardSummary } from "@/lib/insights/dashboard/getDashboardSummary";
import DashboardRealtimeClient from "./_components/DashboardRealtimeClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

const SIGNOUT_REDIRECT = "/api/auth/signout?callbackUrl=%2Flogin";

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
  if (!org) redirect(SIGNOUT_REDIRECT);

  const summary = await getDashboardSummary(session.user.orgId);
  const financialActionsDisabled = org.kybStatus !== "APPROVED";

  return (
    <DashboardRealtimeClient
      initialSummary={summary}
      kybStatus={org.kybStatus}
      financialActionsDisabled={financialActionsDisabled}
      wallet={wallet}
    />
  );
}