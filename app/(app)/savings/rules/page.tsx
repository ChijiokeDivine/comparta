// app/(app)/savings/rules/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { StatusPill } from "@/app/components/StatusPill";
import SavingsSubNav from "../_components/SavingsSubNav";

interface SavingsRule {
  id: string;
  name: string | null;
  trigger: "PERCENTAGE_OF_INCOME" | "ROUND_UP" | "FIXED_RECURRING";
  displayValue: string;
  active: boolean;
  lastExecutedAt: string | null;
}

const TRIGGER_LABEL: Record<SavingsRule["trigger"], string> = {
  PERCENTAGE_OF_INCOME: "% of income",
  ROUND_UP: "Round-up",
  FIXED_RECURRING: "Fixed recurring",
};

export default function SavingsRulesPage() {
  const { data: session } = useSession();
  const canManage = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [rules, setRules] = useState<SavingsRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/savings/rules")
      .then((res) => res.json())
      .then((data) => setRules(data.savingsRules ?? []))
      .catch(() => setError("Failed to load savings rules"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Savings</h1>
        {canManage && (
          <Link
            href="/savings/rules/new"
            className="btn-3d btn-3d--sm"
            style={
              {
                "--btn-bg": "#2A5CE6",
                "--btn-bg-hover": "#2450d1",
                "--btn-edge": "#1A3FA8",
                "--btn-edge-hover": "#17358f",
                color: "#ffffff",
              } as React.CSSProperties
            }
          >
            New rule
          </Link>
        )}
      </div>

      <SavingsSubNav active="rules" />

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No auto-save rules yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {rules.map((rule) => (
            <Link
              key={rule.id}
              href={`/savings/rules/${rule.id}/edit`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#0B1E3F]">{rule.name ?? TRIGGER_LABEL[rule.trigger]}</p>
                  {!rule.active && <StatusPill value="ARCHIVED" label="Inactive" />}
                </div>
                <p className="text-xs text-[#7C8CA6]">{TRIGGER_LABEL[rule.trigger]}</p>
              </div>
              <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">{rule.displayValue}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}