// app/(app)/wallet/unified-balance/deposit/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getBalance } from "@/lib/ledger/engine";
import { toDecimalString } from "@/lib/circle/amount";
import { KybBanner } from "../../../_components/Kyb";
import UnifiedDepositForm from "./UnifiedDepositForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fund Unified Balance",
};

export default async function UnifiedBalanceDepositPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const [org, wallet, ledgerAccounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.user.orgId }, select: { kybStatus: true } }),
    prisma.wallet.findFirst({ where: { orgId: session.user.orgId } }),
    prisma.ledgerAccount.findMany({
      where: { orgId: session.user.orgId, archived: false },
      orderBy: { name: "asc" },
    }),
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
      <div>
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Fund Unified Balance</h1>
        <p className="mt-1.5 text-sm text-[#7C8CA6]">
          Move USDC from Arc into Circle Gateway for cross-chain sends. Chosen buckets are
          debited so ledger stays aligned with onchain Arc balance. Unified Balance is tracked
          separately.
        </p>
      </div>
      {wallet ? (
        <UnifiedDepositForm
          walletAddress={wallet.arcAddress}
          buckets={buckets}
          disabled={org.kybStatus !== "APPROVED"}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No wallet has been provisioned for this organization yet.
        </div>
      )}
    </div>
  );
}
