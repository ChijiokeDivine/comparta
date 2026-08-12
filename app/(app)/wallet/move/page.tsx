// app/(app)/wallet/move/page.tsx
//
// Internal bucket-to-bucket move page (Operating → Savings, etc.).
// Purely a Postgres ledger transfer — zero-sum, no onchain activity.
// Wires the org's non-archived buckets into the BucketTransferForm
// client component; supports ?from= and ?to= query params so a bucket
// detail page can prefill the source or target bucket (e.g. "Move
// money OUT of Operating").

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { getBalance } from "@/lib/ledger/engine";
import { KybBanner } from "../../_components/Kyb";
import BucketTransferForm from "./BucketTransferForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Move between buckets",
};

export default async function MoveBetweenBucketsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const { from: prefillFrom, to: prefillTo } = await searchParams;

  const [org, ledgerAccounts] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.user.orgId },
      select: { kybStatus: true },
    }),
    prisma.ledgerAccount.findMany({
      where: { orgId: session.user.orgId, archived: false },
      orderBy: [{ type: "asc" }, { name: "asc" }],
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
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">
          Move between buckets
        </h1>
        <p className="text-sm text-[#7C8CA6]">
          Instant internal transfer. No fees.
        </p>
      </div>
      <BucketTransferForm
        buckets={buckets}
        disabled={org.kybStatus !== "APPROVED"}
        initialFrom={prefillFrom}
        initialTo={prefillTo}
      />
    </div>
  );
}
