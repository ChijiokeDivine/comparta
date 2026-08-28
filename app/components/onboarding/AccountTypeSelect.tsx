// components/onboarding/AccountTypeSelect.tsx
"use client";

import { GraduationCap, User, Briefcase, Building2 } from "lucide-react";

// Mirrors the AccountType enum in schema.prisma — keep in sync if that
// enum ever changes.
export type AccountTypeValue = "STUDENT" | "PERSONAL" | "BUSINESS" | "ORGANIZATION";

const OPTIONS: {
  value: AccountTypeValue;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}[] = [
  { value: "STUDENT", label: "Student", icon: GraduationCap },
  { value: "PERSONAL", label: "Personal", icon: User },
  { value: "BUSINESS", label: "Business", icon: Briefcase },
  { value: "ORGANIZATION", label: "Organization", icon: Building2 },
];

interface AccountTypeSelectProps {
  value: AccountTypeValue | "";
  onChange: (value: AccountTypeValue) => void;
  error?: string;
}

// "What best describes you?" — a 2x2 grid of selectable cards rather than
// a <select>, since there are only four options and this reads better as
// a single glanceable choice than a dropdown. Built as a role="radiogroup"
// of buttons (not real radio inputs) so it can share the exact
// border/focus treatment used by the text inputs on this form.
export default function AccountTypeSelect({ value, onChange, error }: AccountTypeSelectProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#0B1E3F] mb-3 mt-5">
        What best describes you?
      </label>

      <div role="radiogroup" aria-label="What best describes you?" className="grid grid-cols-2 gap-3 mb-5">
        {OPTIONS.map(({ value: optionValue, label, icon: Icon }) => {
          const active = value === optionValue;
          return (
            <button
              key={optionValue}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(optionValue)}
              className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left transition-all ${
                active
                  ? "border-[#2A5CE6] bg-[#2A5CE6]/5"
                  : "border-[#E5E9F2] hover:border-[#2A5CE6]/40"
              }`}
            >
              <Icon
                size={18}
                strokeWidth={2}
                className={active ? "text-[#2A5CE6]" : "text-[#7C8CA6]"}
              />
              <span
                className={`text-sm md:text-base font-medium ${
                  active ? "text-[#0B1E3F]" : "text-[#4A5A78]"
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}