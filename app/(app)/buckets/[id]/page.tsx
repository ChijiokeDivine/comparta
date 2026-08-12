// app/(app)/buckets/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { getBucketDetail, BucketNotFoundError } from "@/lib/buckets/service";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney } from "@/app/invoices/_components/format";
import { ArrowRightLeft as MoveInIcon, ArrowLeftRight as MoveOutIcon } from "lucide-react";
import BucketActions from "./BucketActions";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bucket detail",
};

export default async function BucketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";

  const bucket = await getBucketDetail(session.user.orgId, id).catch((err) => {
    if (err instanceof BucketNotFoundError) return null;
    throw err;
  });
  if (!bucket) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/buckets" className="text-sm font-medium text-[#2A5CE6] hover:underline">
        ← Buckets
      </Link>

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <StatusPill value={bucket.type} />
              {bucket.archived && <StatusPill value="ARCHIVED" />}
            </div>
            <h1 className="text-xl font-semibold text-[#0B1E3F] truncate">{bucket.name}</h1>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-[#7C8CA6] mb-1">Balance</p>
          <p className="text-3xl font-semibold text-[#0B1E3F] tabular-nums">
            {formatMoney(bucket.balance)}
          </p>
        </div>

        {canManage && !bucket.archived && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/wallet/move?to=${encodeURIComponent(bucket.id)}`}
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1E3F] px-3 py-2 rounded-xl border border-[#E5E9F2] bg-white hover:bg-[#F7F8FB] transition-colors"
            >
              <MoveInIcon className="w-3.5 h-3.5 text-[#2A5CE6]" />
              Move into this bucket
            </Link>
            <Link
              href={`/wallet/move?from=${encodeURIComponent(bucket.id)}`}
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1E3F] px-3 py-2 rounded-xl border border-[#E5E9F2] bg-white hover:bg-[#F7F8FB] transition-colors"
            >
              <MoveOutIcon className="w-3.5 h-3.5 text-[#2A5CE6]" />
              Move out of this bucket
            </Link>
          </div>
        )}

        {bucket.sparkline.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[#7C8CA6] mb-2">Last 30 days</p>
            <Sparkline points={bucket.sparkline} />
          </div>
        )}

        {canManage && !bucket.archived && (
          <BucketActions bucketId={bucket.id} currentName={bucket.name} balance={bucket.balance} />
        )}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { date: string; balance: string }[] }) {
  const values = points.map((p) => Number(p.balance));
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  return (
    <div className="flex items-end gap-0.5 h-16">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-[#EEF2FF] rounded-sm"
          style={{ height: `${Math.max(((v - min) / range) * 100, 4)}%` }}
          title={`${points[i].date}: ${points[i].balance}`}
        />
      ))}
    </div>
  );
}