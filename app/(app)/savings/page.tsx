// app/(app)/savings/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { listBucketsWithBalances } from "@/lib/buckets/service";
import { StatusPill } from "@/app/components/StatusPill";
import SavingsSubNav from "./_components/SavingsSubNav";
import { formatMoney } from "@/app/invoices/_components/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Savings" };

export default async function SavingsBucketsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const buckets = await listBucketsWithBalances(session.user.orgId, {
    includeSparkline: false,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#0B1E3F]">Savings</h1>
      <SavingsSubNav active="buckets" />

      {buckets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No buckets yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {buckets.map((bucket) => (
            <Link
              key={bucket.id}
              href={`/savings/${bucket.id}`}
              className="rounded-2xl border border-[#E5E9F2] bg-white p-5 hover:border-[#2A5CE6] hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <StatusPill value={bucket.type} />
              </div>
              <p className="text-sm font-semibold text-[#0B1E3F] truncate mb-1">{bucket.name}</p>
              <p className="text-xl font-semibold text-[#0B1E3F] tabular-nums">
                {formatMoney(bucket.balance)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
