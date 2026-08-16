// app/(app)/dashboard/_components/ActivityFeed.tsx
import Image from "next/image";
import Link from "next/link";
import type { ActivityItem } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney, formatRelativeTime } from "@/app/invoices/_components/format";

const KIND_STYLES: Record<ActivityItem["kind"], { bg: string; fg: string; glyph: string }> = {
  onchain_in: { bg: "bg-emerald-50", fg: "text-emerald-600", glyph: "↓" },
  onchain_out: { bg: "bg-[#F2F4F8]", fg: "text-[#3E4A6B]", glyph: "↑" },
  invoice_event: { bg: "bg-[#EEF2FF]", fg: "text-[#2A5CE6]", glyph: "🧾" },
  payroll_run: { bg: "bg-violet-50", fg: "text-violet-600", glyph: "👥" },
  payment_link_payment: { bg: "bg-amber-50", fg: "text-amber-600", glyph: "🔗" },
  savings_execution: { bg: "bg-emerald-50", fg: "text-emerald-600", glyph: "🌱" },
  allocation_execution: { bg: "bg-[#F2F4F8]", fg: "text-[#3E4A6B]", glyph: "⇄" },
};

const MAX_VISIBLE = 7;

export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6] flex flex-col items-center justify-center min-h-[300px] ">
         No activity yet. Once money moves, it&apos;ll show up here.
        <div className="relative w-24 h-24 mt-4 flex items-center justify-center">
          <Image
            src="/coins.webp"
            alt="No activity"
            fill
            className="object-contain"
          />
        </div>
       
      </div>
    );
  }

  const hasMore = items.length > MAX_VISIBLE;
  const visible = hasMore ? items.slice(0, MAX_VISIBLE) : items;

  return (
    <div className="rounded-2xl border border-[#E5E9F2] bg-white">
      <div className="divide-y divide-[#F2F4F8]">
        {visible.map((item) => {
          const style = KIND_STYLES[item.kind];
          return (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3.5 ">
              <span
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0 ${style.bg} ${style.fg}`}
                aria-hidden="true"
              >
                {style.glyph}
              </span>
              <div className="min-w-0 flex-1 pt-3">
                <p className="text-sm font-medium text-[#0B1E3F] truncate">{item.title}</p>
                <p className="text-xs text-[#7C8CA6] truncate">{item.subtitle}</p>
              </div>
              <div className="text-right shrink-0">
                {item.amount && (
                  <p className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                    {formatMoney(item.amount)}
                  </p>
                )}
                <p className="text-xs text-[#7C8CA6]">{formatRelativeTime(item.createdAt)}</p>
              </div>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div className="px-5 py-3 border-t border-[#F2F4F8]">
          <Link
            href="/wallet/transfers"
            className="text-sm font-medium text-[#2A5CE6] hover:underline inline-flex items-center gap-1"
          >
            View all {items.length} items
          </Link>
        </div>
      )}
    </div>
  );
}