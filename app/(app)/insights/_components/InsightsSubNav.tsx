// app/(app)/insights/_components/InsightsSubNav.tsx
import Link from "next/link";

export default function InsightsSubNav({ active }: { active: "overview" | "anomalies" | "categorize" }) {
  const items = [
    { key: "overview" as const, href: "/insights", label: "Overview" },
    { key: "anomalies" as const, href: "/insights/anomalies", label: "Anomalies" },
    { key: "categorize" as const, href: "/insights/categorize", label: "Needs review" },
  ];

  return (
    <div className="flex gap-2 border-b border-[#E5E9F2]">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            active === item.key
              ? "border-[#2A5CE6] text-[#2A5CE6]"
              : "border-transparent text-[#7C8CA6] hover:text-[#3E4A6B]"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}