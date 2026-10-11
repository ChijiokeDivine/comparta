// app/(app)/dashboard/_components/ActivityFeed.tsx
import Image from "next/image";
import Link from "next/link";
import type { ActivityItem } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney, formatRelativeTime } from "@/app/invoices/_components/format";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Receipt,
  Users,
  Link2,
  Sprout,
  type LucideIcon,
} from "lucide-react";


const KIND_STYLES: Record<
  ActivityItem["kind"],
  { bg: string; fg: string; icon: LucideIcon }
> = {
  onchain_in: { bg: "bg-[#F5F7FA]", fg: "text-[#3E4A6B]", icon: ArrowDownLeft },
  onchain_out: { bg: "bg-[#F5F7FA]", fg: "text-[#3E4A6B]", icon: ArrowUpRight },
  invoice_event: { bg: "bg-[#EEF2FF]", fg: "text-[#2A5CE6]", icon: Receipt },
  payroll_run: { bg: "bg-violet-50", fg: "text-violet-600", icon: Users },
  payment_link_payment: { bg: "bg-amber-50", fg: "text-amber-600", icon: Link2 },
  savings_execution: { bg: "bg-emerald-50", fg: "text-emerald-600", icon: Sprout },
  allocation_execution: { bg: "bg-[#F5F7FA]", fg: "text-[#3E4A6B]", icon: ArrowLeftRight },
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
          const Icon = style.icon;
          return (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3.5 ">
              <span
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${style.bg} ${style.fg}`}
                aria-hidden="true"
                >
                <Icon className="w-4 h-4" strokeWidth={2} />
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
            className="text-sm font-medium text-[#333333] hover:underline inline-flex items-center gap-1"
          >
            View all {items.length} items
          </Link>
        </div>
      )}
    </div>
  );
}