"use client";

import Link from "next/link";
import type { BucketSummary } from "@/lib/buckets/service";
import { formatMoney } from "@/app/invoices/_components/format";
import { useHideBalances, maskBalance } from "@/app/(app)/_components/HideBalancesProvider";
import {
  Briefcase as OperatingIcon,
  Shield as ReserveIcon,
  Users as PayrollIcon,
  Sprout as SavingsIcon,
  Wallet as DefaultBucketIcon,
} from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  OPERATING: "Operating",
  RESERVE: "Reserve",
  PAYROLL: "Payroll",
  SAVINGS: "Savings",
  CUSTOM: "Bucket",
};

const TYPE_ICON: Record<string, typeof DefaultBucketIcon> = {
  OPERATING: OperatingIcon,
  RESERVE: ReserveIcon,
  PAYROLL: PayrollIcon,
  SAVINGS: SavingsIcon,
};

export default function BucketCards({
  buckets,
}: {
  buckets: BucketSummary[];
}) {
  const { hideBalances } = useHideBalances();
  const sortedBuckets = [...buckets].sort((a, b) => Number(b.balance) - Number(a.balance));
  const visibleBuckets = sortedBuckets.slice(0, 3);

  return (
    <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="md:text-lg text-lg font-medium text-[#0B1E3F]">Buckets</h3>

        {buckets.length > 0 && (
          <Link
            href="/buckets"
            className="md:text-xs text-xs font-medium text-[#333333] hover:underline"
          >
            View all
          </Link>
        )}
      </div>

      {buckets.length === 0 ? (
        <Link
          href="/buckets/new"
          className="flex h-36 items-center justify-center rounded-2xl border border-dashed border-[#DCE3F0] text-sm text-[#7C8CA6] hover:border-[#2A5CE6] hover:text-[#2A5CE6] transition-colors"
        >
          Create your first bucket
        </Link>
      ) : (
        <div className="space-y-4">
          {visibleBuckets.map((bucket) => {
            const Icon = TYPE_ICON[bucket.type] ?? DefaultBucketIcon;
            const isDefault = !TYPE_ICON[bucket.type];
            return (
              <Link
                key={bucket.id}
                href={`/buckets/${bucket.id}`}
                className="flex items-center justify-between rounded-xl p-2 -mx-2 hover:bg-[#F7F9FC] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E5E9F2] bg-[#FAFBFD]">
                    {isDefault ? (
                      <span className="text-lg">🪣</span>
                    ) : (
                      <Icon className="w-4 h-4 text-[#535353]" />
                    )}
                  </div>

                  <div>
                    <p className="md:text-sm text-sm font-medium text-[#0B1E3F]">
                      {bucket.name}
                    </p>

                    <p className="md:text-xs text-xs text-[#7C8CA6]">
                      {TYPE_LABEL[bucket.type] ?? bucket.type}
                    </p>
                  </div>
                </div>

                <p className="md:text-md text-sm font-medium text-[#0B1E3F] tabular-nums">
                  {maskBalance(formatMoney(bucket.balance), hideBalances)}
                </p>
              </Link>
            );
          })}

          {/* {buckets.length > 3 && (
            <Link
              href="/buckets"
              className="flex items-center gap-3 rounded-xl p-2 -mx-2 hover:bg-[#F7F9FC] transition-colors"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F2F5FA] md:text-sm text-xs font-medium text-[#5F6B7A]">
                +{buckets.length - 3}
              </div>

              <span className="font-medium text-[#0B1E3F]">
                View all buckets
              </span>
            </Link>
          )} */}
        </div>
      )}
    </div>
  );
}