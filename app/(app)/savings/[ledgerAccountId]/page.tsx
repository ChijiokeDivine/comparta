// app/(app)/savings/[ledgerAccountId]/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { KybBanner } from "../../_components/Kyb";
import SavingsBucketOverview from "./SavingsBucketOverview";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Savings bucket" };

export default async function SavingsBucketPage({
  params,
}: {
  params: Promise<{ ledgerAccountId: string }>;
}) {
  const { ledgerAccountId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const org = await prisma.organization.findUnique({
    where: { id: session.user.orgId },
    select: { kybStatus: true },
  });
  if (!org) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";

  return (
    <div className="max-w-2xl space-y-6">
      <KybBanner status={org.kybStatus} />
      <SavingsBucketOverview
        ledgerAccountId={ledgerAccountId}
        canManage={canManage}
        kybApproved={org.kybStatus === "APPROVED"}
      />
    </div>
  );
}