// app/(app)/wallet/unified-balance/spend/page.tsx
//
// Mirrors app/(app)/wallet/transfer/page.tsx's server-component shape
// (fetch buckets, gate on KYB, hand off to a client form). Separate route
// from /wallet/transfer rather than a mode toggle on that page — see
// lib/transfers/sendUnified.ts's module docstring for why the underlying
// send path is a different function, not a branch of the existing one.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { getBalance } from "@/lib/ledger/engine";
import { KybBanner } from "../../../_components/Kyb";
import UnifiedSpendForm from "./UnifiedSpendForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spend Unified Balance",
};

export default async function UnifiedBalanceSpendPage() {
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
      <div>
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Spend Unified Balance</h1>
        <p className="text-sm text-[#7C8CA6] mt-1">
          Sends to any address on any chain your Unified Balance supports — App Kit draws from
          whichever confirmed source-chain balances cover the amount.
        </p>
      </div>
      <UnifiedSpendForm buckets={buckets} disabled={org.kybStatus !== "APPROVED"} />
    </div>
  );
}
