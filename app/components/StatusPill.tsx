// app/(app)/_components/StatusPill.tsx
//
// Generic small status/type pill. Colors are chosen per literal enum
// value so every page renders the EXACT string the DB stores (per the
// build spec) with a consistent visual language across the app.

const STYLES: Record<string, string> = {
  // OnchainTxStatus
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  // LedgerAccountType
  OPERATING: "bg-[#EEF2FF] text-[#2A5CE6] border-[#DDE5FB]",
  RESERVE: "bg-violet-50 text-violet-700 border-violet-200",
  PAYROLL: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  SAVINGS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CUSTOM: "bg-[#F2F4F8] text-[#3E4A6B] border-[#E5E9F2]",
  // generic fallback tones
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-[#F2F4F8] text-[#7C8CA6] border-[#E5E9F2]",
};

export function StatusPill({ value, label }: { value: string; label?: string }) {
  const style = STYLES[value] ?? "bg-[#F2F4F8] text-[#3E4A6B] border-[#E5E9F2]";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${style}`}>
      {label ?? value}
    </span>
  );
}