// app/(app)/payroll/_components/PayrollSubNav.tsx
import Link from "next/link";

export default function PayrollSubNav({ active }: { active: "runs" | "payees" }) {
  return (
    <div className="flex gap-2 border-b border-[#E5E9F2]">
      <Link
        href="/payroll"
        className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
          active === "runs"
            ? "border-[#2A5CE6] text-[#2A5CE6]"
            : "border-transparent text-[#7C8CA6] hover:text-[#3E4A6B]"
        }`}
      >
        Runs
      </Link>
      <Link
        href="/payroll/payees"
        className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
          active === "payees"
            ? "border-[#2A5CE6] text-[#2A5CE6]"
            : "border-transparent text-[#7C8CA6] hover:text-[#3E4A6B]"
        }`}
      >
        Payees
      </Link>
    </div>
  );
}