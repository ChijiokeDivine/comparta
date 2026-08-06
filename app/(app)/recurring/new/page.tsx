// app/(app)/recurring/new/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { KybBanner } from "../../_components/Kyb";
import NewRecurringTransferForm from "./NewRecurringTransferForm";
import type {Metadata} from "next";

export const metadata: Metadata = { title: "New recurring transfer" };

export default async function NewRecurringTransferPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";
  if (!canManage) redirect("/recurring");

  const [org, ledgerAccounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.user.orgId }, select: { kybStatus: true } }),
    prisma.ledgerAccount.findMany({
      where: { orgId: session.user.orgId, archived: false },
      select: { id: true, name: true },
    }),
  ]);
  if (!org) redirect("/login");

  return (
    <div className="max-w-lg space-y-6">
      <KybBanner status={org.kybStatus} />
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New recurring transfer</h1>
      <NewRecurringTransferForm buckets={ledgerAccounts} disabled={org.kybStatus !== "APPROVED"} />
    </div>
  );
}