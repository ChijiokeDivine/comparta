// app/(app)/savings/[ledgerAccountId]/SavingsBucketOverview.tsx
import { formatMoney } from "@/app/invoices/_components/format";

export default function SavingsBucketOverview({
  name,
  balance,
}: {
  name: string;
  balance: string;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6">
        <p className="text-xs font-medium text-[#7C8CA6] mb-1">{name}</p>
        <p className="text-3xl font-semibold text-[#0B1E3F] tabular-nums">
          {formatMoney(balance)}
        </p>
        <p className="text-sm text-[#7C8CA6] mt-1">
          Available to spend, transfer, or sweep.
        </p>
      </div>
    </div>
  );
}
