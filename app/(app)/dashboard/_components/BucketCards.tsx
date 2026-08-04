// app/(app)/dashboard/_components/BucketCards.tsx
import Link from "next/link";
import type { BucketSummary } from "@/lib/buckets/service";
import { formatMoney } from "@/app/invoices/_components/format";

const TYPE_LABEL: Record<string, string> = {
  OPERATING: "Operating",
  RESERVE: "Reserve",
  PAYROLL: "Payroll",
  SAVINGS: "Savings",
  CUSTOM: "Bucket",
};

export default function BucketCards({ buckets }: { buckets: BucketSummary[] }) {
  if (buckets.length === 0) {
    return (
      <Link
        href="/buckets/new"
        className="block rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-6 text-center text-sm text-[#7C8CA6] hover:border-[#2A5CE6] hover:text-[#2A5CE6] transition-colors"
      >
        No buckets yet — create your first one
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {buckets.slice(0, 6).map((bucket) => (
        <Link
          key={bucket.id}
          href={`/buckets/${bucket.id}`}
          className="rounded-2xl border border-[#E5E9F2] bg-white p-5 hover:border-[#2A5CE6] hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#7C8CA6]">
              {TYPE_LABEL[bucket.type] ?? bucket.type}
            </span>
          </div>
          <p className="text-sm font-semibold text-[#0B1E3F] truncate mb-1">{bucket.name}</p>
          <p className="text-xl font-semibold text-[#0B1E3F] tabular-nums">
            {formatMoney(bucket.balance)}
          </p>
        </Link>
      ))}
    </div>
  );
}