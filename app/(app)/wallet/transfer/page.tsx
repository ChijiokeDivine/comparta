// app/(app)/wallet/transfer/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { getBalance } from "@/lib/ledger/engine";
import { KybBanner } from "../../_components/Kyb";
import TransferForm from "./TransferForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New transfer",
};

export default async function NewTransferPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const [org, ledgerAccounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.user.orgId }, select: { kybStatus: true } }),
    prisma.ledgerAccount.findMany({ where: { orgId: session.user.orgId, archived: false } }),
  ]);
  if (!org) redirect("/login");

  const buckets = await Promise.all(
    ledgerAccounts.map(async (a) => ({
      id: a.id,
      name: a.name,
      balance: toDecimalString(await getBalance(a.id)),
    }))
  );

  return (
    <div className="max-w-lg space-y-6">
      <KybBanner status={org.kybStatus} />
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New transfer</h1>
      <TransferForm buckets={buckets} disabled={org.kybStatus !== "APPROVED"} />
    </div>
  );
}