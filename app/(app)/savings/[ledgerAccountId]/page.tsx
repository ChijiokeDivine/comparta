// app/(app)/savings/[ledgerAccountId]/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { getBalance } from "@/lib/ledger/engine";
import { toDecimalString } from "@/lib/circle/amount";
import { getBucket } from "@/lib/buckets/service";
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

  // getBucket scopes by org, so another org's bucket id 404s here rather
  // than leaking its balance.
  const bucket = await getBucket(session.user.orgId, ledgerAccountId).catch(
    () => null
  );
  if (!bucket) redirect("/savings");

  const balance = await getBalance(bucket.id);

  return (
    <div className="max-w-2xl space-y-6">
      <SavingsBucketOverview
        name={bucket.name}
        balance={toDecimalString(balance)}
      />
    </div>
  );
}
