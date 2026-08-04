// app/(app)/wallet/transfers/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney, formatDate } from "@/app/invoices/_components/format";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transfer detail",
};

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  // Ownership check: the transaction's wallet must belong to this org —
  // OnchainTransaction has no direct orgId column, only walletId.
  const tx = await prisma.onchainTransaction.findFirst({
    where: { id, wallet: { orgId: session.user.orgId } },
  });
  if (!tx) notFound();

  const timeline = [
    { label: "Created", at: tx.createdAt, done: true },
    { label: tx.status === "FAILED" ? "Failed" : "Confirmed", at: tx.confirmedAt, done: !!tx.confirmedAt || tx.status === "FAILED" },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/wallet/transfers" className="text-sm font-medium text-[#2A5CE6] hover:underline">
        ← Transfers
      </Link>

      <div className="rounded-2xl border border-[#E5E9F2] bg-white p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-[#7C8CA6] mb-1">
              {tx.direction === "IN" ? "Received" : "Sent"}
            </p>
            <p className="text-2xl font-semibold text-[#0B1E3F] tabular-nums">
              {formatMoney(toDecimalString(tx.amount))}
            </p>
          </div>
          <StatusPill value={tx.status} />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[#7C8CA6] mb-1">Counterparty</dt>
            <dd className="font-mono text-[#0B1E3F] break-all">{tx.counterpartyAddress}</dd>
          </div>
          <div>
            <dt className="text-[#7C8CA6] mb-1">Chain</dt>
            <dd className="text-[#0B1E3F]">{tx.chain.replace(/_/g, " ")}</dd>
          </div>
          {tx.memo && (
            <div className="sm:col-span-2">
              <dt className="text-[#7C8CA6] mb-1">Memo</dt>
              <dd className="text-[#0B1E3F]">{tx.memo}</dd>
            </div>
          )}
          {tx.txHash && (
            <div className="sm:col-span-2">
              <dt className="text-[#7C8CA6] mb-1">Transaction hash</dt>
              <dd className="font-mono text-[#0B1E3F] break-all text-xs">{tx.txHash}</dd>
            </div>
          )}
        </dl>

        <div className="pt-4 border-t border-[#F2F4F8]">
          <p className="text-xs font-semibold text-[#7C8CA6] mb-3">Status timeline</p>
          <ol className="space-y-3">
            {timeline.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    step.done ? "bg-[#2A5CE6]" : "bg-[#E5E9F2]"
                  }`}
                />
                <span className="text-sm text-[#0B1E3F]">{step.label}</span>
                {step.at && <span className="text-xs text-[#7C8CA6]">{formatDate(step.at)}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}