// app/(app)/dashboard/_components/UpcomingCard.tsx
import Link from "next/link";
import type { UpcomingItem } from "@/lib/insights/dashboard/getDashboardSummary";
import { formatMoney, formatRelativeTime } from "@/app/invoices/_components/format";
import { Users, Repeat, CalendarClock, type LucideIcon } from "lucide-react";

const KIND: Record<
  UpcomingItem["kind"],
  { bg: string; fg: string; icon: LucideIcon }
> = {
  payroll_schedule: { bg: "bg-violet-50", fg: "text-violet-600", icon: Users },
  recurring_transfer: { bg: "bg-sky-50", fg: "text-sky-600", icon: Repeat },
};

const MAX_VISIBLE = 5;

export default function UpcomingCard({ items }: { items: UpcomingItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6] flex flex-col items-center justify-center min-h-[360px]">
        Nothing scheduled yet.
        <p className="mt-1 text-xs text-[#A0AEC0]">
          Set up arecurring transfer to see it here.
        </p>
        <div className="mt-4 flex gap-3">
        
          <Link href="/recurring/new" className="text-xs font-medium text-[#2A5CE6] hover:underline">
            Create a recurring payment
          </Link>
        </div>
      </div>
    );
  }

  const visible = items.slice(0, MAX_VISIBLE);

  return (
    <div className="rounded-2xl border border-[#E5E9F2] bg-white">
      <div className="divide-y divide-[#F2F4F8]">
        {visible.map((item) => {
          const style = KIND[item.kind];
          const Icon = style.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#F7F9FC] transition-colors"
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${style.bg} ${style.fg}`}
              >
                <Icon className="w-3 h-3" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#0B1E3F] truncate">{item.title}</p>
                <p className="text-[10px] text-[#7C8CA6] truncate">{item.subtitle}</p>
              </div>
              <div className="text-right shrink-0">
                {item.amount && (
                  <p className="text-xs font-semibold text-[#0B1E3F] tabular-nums">
                    ${formatMoney(item.amount)}
                  </p>
                )}
                <p className="text-[10px] text-[#7C8CA6] inline-flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" />
                  {formatRelativeTime(item.nextAt)}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}