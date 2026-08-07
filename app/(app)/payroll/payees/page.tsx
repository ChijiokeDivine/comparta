// app/(app)/payroll/payees/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { StatusPill } from "@/app/components/StatusPill";
import PayrollSubNav from "../_components/PayrollSubNav";
import { formatMoney } from "@/app/invoices/_components/format";

interface Payee {
  id: string;
  name: string;
  identifier: string;
  payType: "SALARY" | "HOURLY" | "CONTRACT";
  defaultAmount: string | null;
  active: boolean;
}

export default function PayeesPage() {
  const { data: session } = useSession();
  const canManage = session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  const [payees, setPayees] = useState<Payee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/payroll/payees")
      .then((res) => res.json())
      .then((data) => setPayees(data.payees ?? []))
      .catch(() => setError("Failed to load payees"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Payroll</h1>
        {canManage && (
          <Link
            href="/payroll/payees/new"
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
            New payee
          </Link>
        )}
      </div>

      <PayrollSubNav active="payees" />

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && payees.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No payees yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {payees.map((p) => (
            <Link
              key={p.id}
              href={`/payroll/payees/${p.id}/edit`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#0B1E3F] truncate">{p.name}</p>
                  {!p.active && <StatusPill value="ARCHIVED" label="Inactive" />}
                </div>
                <p className="text-xs text-[#7C8CA6] font-mono truncate">{p.identifier}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                  {p.defaultAmount ? formatMoney(p.defaultAmount) : "-"}
                </span>
                <StatusPill value={p.payType} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}