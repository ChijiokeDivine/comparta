// app/(app)/settings/_components/SettingsSubNav.tsx
import Link from "next/link";

export default function SettingsSubNav({ active }: { active: "organization" | "team" | "account" }) {
  const items = [
    { key: "organization" as const, href: "/settings", label: "Organization" },
    { key: "team" as const, href: "/settings/team", label: "Team" },
    { key: "account" as const, href: "/settings/account", label: "My account" },
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