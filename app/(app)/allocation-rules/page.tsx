// app/(app)/allocation-rules/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { listAllocationRules } from "@/lib/allocationRules/service";
import { serializeAllocationRule } from "@/lib/allocationRules/serialize";
import { StatusPill } from "@/app/components/StatusPill";
import type { Metadata } from "next";
import Image from "next/image";
export const metadata: Metadata = { title: "Allocation rules" };

const TRIGGER_LABEL: Record<string, string> = {
  ON_INCOMING_PAYMENT: "On incoming payment",
  SCHEDULED: "Scheduled",
};

export default async function AllocationRulesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";

  const [rules, ledgerAccounts] = await Promise.all([
    listAllocationRules(session.user.orgId, {}),
    prisma.ledgerAccount.findMany({
      where: { orgId: session.user.orgId },
      select: { id: true, name: true },
    }),
  ]);
  const bucketName = new Map(ledgerAccounts.map((a) => [a.id, a.name]));
  const serialized = rules.map(serializeAllocationRule);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Allocation rules</h1>
        {canManage && (
          <Link
            href="/allocation-rules/new"
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
      <p className="text-sm text-[#7C8CA6]">
        Automatically split incoming payments or scheduled sweeps across buckets.
      </p>

      {serialized.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6] flex flex-col items-center justify-center h-[220px] ">
          No allocation rules yet.
          <div className="flex items-center justify-center mt-5">
          <Image
            src="/allocation.webp"
            alt="USDC"
            width={50}
            height={50}
            className=" rounded-full"
          />
          </div>
          
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
          {serialized.map((rule) => (
            <Link
              key={rule.id}
              href={`/allocation-rules/${rule.id}/edit`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#0B1E3F] truncate">
                    {rule.name ?? `${bucketName.get(rule.sourceLedgerAccountId)} → ${bucketName.get(rule.targetLedgerAccountId)}`}
                  </p>
                  {!rule.active && <StatusPill value="ARCHIVED" label="Inactive" />}
                </div>
                <p className="text-xs text-[#7C8CA6]">
                  {bucketName.get(rule.sourceLedgerAccountId)} → {bucketName.get(rule.targetLedgerAccountId)} ·{" "}
                  {TRIGGER_LABEL[rule.trigger]} · priority {rule.priority}
                </p>
              </div>
              <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums shrink-0">
                {rule.displayValue}
                {rule.ruleType === "PERCENTAGE" ? "%" : " USDC"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}