// app/(app)/savings/_components/SavingsSubNav.tsx
import Link from "next/link";

export default function SavingsSubNav({ active }: { active: "buckets" | "rules" }) {
  return (
    <div className="flex gap-2 border-b border-[#E5E9F2]">
      <Link
        href="/savings"
        className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
          active === "buckets"
            ? "border-[#2A5CE6] text-[#2A5CE6]"
            : "border-transparent text-[#7C8CA6] hover:text-[#3E4A6B]"
        }`}
      >
        Buckets
      </Link>
      <Link
        href="/savings/rules"
        className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
          active === "rules"
            ? "border-[#2A5CE6] text-[#2A5CE6]"
            : "border-transparent text-[#7C8CA6] hover:text-[#3E4A6B]"
        }`}
      >
        Auto-save rules
      </Link>
    </div>
  );
}