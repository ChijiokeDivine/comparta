// app/(app)/payroll/runs/new/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { listPayees } from "@/lib/payroll/payees";
import { serializePayee } from "@/lib/payroll/serialize";
import { KybBanner } from "../../../_components/Kyb";
import NewRunForm from "./NewRunForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "New payroll run" };

export default async function NewPayrollRunPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";
  if (!canManage) redirect("/payroll");

  const [org, ledgerAccounts, payees] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.user.orgId }, select: { kybStatus: true } }),
    prisma.ledgerAccount.findMany({
      where: { orgId: session.user.orgId, archived: false },
      select: { id: true, name: true },
    }),
    listPayees(session.user.orgId, { active: true }),
  ]);
  if (!org) redirect("/login");

  return (
    <div className="max-w-2xl space-y-6">
      <KybBanner status={org.kybStatus} />
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New payroll run</h1>
      <NewRunForm
        buckets={ledgerAccounts}
        payees={payees.map(serializePayee)}
        disabled={org.kybStatus !== "APPROVED"}
      />
    </div>
  );
}