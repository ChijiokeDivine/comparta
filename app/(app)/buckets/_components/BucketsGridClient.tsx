"use client";

import Link from "next/link";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney } from "@/app/invoices/_components/format";
import { useHideBalances, maskBalance } from "@/app/(app)/_components/HideBalancesProvider";
import type { ListBucketsWithBalancesItem } from "@/lib/buckets/service";

export default function BucketsGridClient({
  buckets,
  canManage,
}: {
  buckets: ListBucketsWithBalancesItem[];
  canManage: boolean;
}) {
  const { hideBalances } = useHideBalances();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Buckets</h1>
        {canManage && (
          <Link
            href="/buckets/new"
            className="btn-3d btn-3d--sm"
            style={
              {
                "--btn-bg": "#2A5CE6",
                "--btn-bg-hover": "#2450d1",
                "--btn-edge": "#1A3FA8",
                "--btn-edge-hover": "#17358f",
                color: "#ffffff",
              } as React.CSSProperties
            }
          >
            New bucket
          </Link>
        )}
      </div>

      {buckets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No buckets yet.{" "}
          {canManage && (
            <Link href="/buckets/new" className="text-[#2A5CE6] font-medium hover:underline">
              Create your first one
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {buckets.map((bucket) => (
            <Link
              key={bucket.id}
              href={`/buckets/${bucket.id}`}
              className="rounded-2xl border border-[#E5E9F2] bg-white p-5 hover:border-[#2A5CE6] hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <StatusPill value={bucket.type} />
              </div>
              <p className="text-sm font-semibold text-[#0B1E3F] truncate mb-1">{bucket.name}</p>
              <p className="text-xl font-semibold text-[#0B1E3F] tabular-nums">
                {maskBalance(formatMoney(bucket.balance), hideBalances)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
