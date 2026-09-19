// app/(app)/wallet/unified-balance/deposit/page.tsx
//
// Mirrors ../spend/page.tsx's shape, but simpler: depositing into Gateway
// doesn't touch Comparta's internal ledger buckets at all (see
// lib/circle/unifiedBalance.ts's module docstring — a deposit just moves
// the wallet's own plain on-chain balance into Gateway's contract), so
// there's no bucket list to fetch here, unlike the spend page.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { KybBanner } from "../../../_components/Kyb";
import UnifiedDepositForm from "./UnifiedDepositForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deposit into Unified Balance",
};

export default async function UnifiedBalanceDepositPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const [org, wallet] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.user.orgId }, select: { kybStatus: true } }),
    prisma.wallet.findFirst({ where: { orgId: session.user.orgId } }),
  ]);
  if (!org) redirect("/login");

  return (
    <div className="max-w-lg space-y-6">
      <KybBanner status={org.kybStatus} />
      <div>
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Deposit into Unified Balance</h1>
      
      </div>
      {wallet ? (
        <UnifiedDepositForm walletAddress={wallet.arcAddress} disabled={org.kybStatus !== "APPROVED"} />
      ) : (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No wallet has been provisioned for this organization yet.
        </div>
      )}
    </div>
  );
}