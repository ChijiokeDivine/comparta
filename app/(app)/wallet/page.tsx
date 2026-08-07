// app/(app)/wallet/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getBalance } from "@/lib/ledger/engine";
import { getUsdcBalance } from "@/lib/circle/wallets";
import { toDecimalString } from "@/lib/circle/amount";
import { KybBanner } from "../_components/Kyb";
import { StatusPill } from "@/app/components/StatusPill";
import { formatMoney } from "@/app/invoices/_components/format";
import CopyAddressButton from "./_components/CopyAddressButton";
import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Wallet",
};

export default async function WalletPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const [org, wallet, ledgerAccounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: session.user.orgId }, select: { kybStatus: true } }),
    prisma.wallet.findFirst({ where: { orgId: session.user.orgId } }),
    prisma.ledgerAccount.findMany({ where: { orgId: session.user.orgId, archived: false } }),
  ]);
  if (!org) redirect("/login");

  const bucketBalances = await Promise.all(
    ledgerAccounts.map(async (a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: toDecimalString(await getBalance(a.id)),
    }))
  );
  const ledgerTotal = bucketBalances.reduce((sum, b) => sum + Number(b.balance), 0);

  const isApproved = org.kybStatus === "APPROVED";
  // The live onchain balance requires an approved org (financial data,
  // same gate as app/api/wallet/balance/route.ts) - skip the Circle call
  // entirely when PENDING/REJECTED rather than letting it throw.
  const onchainUsdc =
    isApproved && wallet ? await getUsdcBalance(wallet.circleWalletId).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <KybBanner status={org.kybStatus} />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0B1E3F]">Wallet</h1>
        {isApproved ? (
          <Link href="/wallet/transfer" className="btn-3d btn-3d--sm" style={sendBtnStyle}>
            Send
          </Link>
        ) : (
          <span
            title="Available once your organization's KYB is approved"
            className="btn-3d btn-3d--sm opacity-50 cursor-not-allowed"
            style={sendBtnStyle}
          >
            Send
          </span>
        )}
      </div>

      {wallet ? (
        <div className="rounded-2xl border border-[#E5E9F2] bg-white p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-medium text-[#7C8CA6] mb-1">Arc address</p>
              <p className="text-sm font-mono text-[#0B1E3F] break-all">{wallet.arcAddress}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill value={wallet.chain} label={wallet.chain.replace(/_/g, " ")} />
              <CopyAddressButton address={wallet.arcAddress} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#F2F4F8]">
            <div>
              <p className="text-xs font-medium text-[#7C8CA6] mb-1">Ledger total (buckets)</p>
              <p className="text-lg font-semibold text-[#0B1E3F] tabular-nums inline-flex items-center gap-1.5">
                <Image
                  src="/usdc.png"
                  alt="USDC"
                  width={20}
                  height={20}
                  className="rounded-full shrink-0"
                />
                {formatMoney(ledgerTotal.toFixed(6))}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#7C8CA6] mb-1">Onchain USDC balance</p>
              <p className="text-lg font-semibold text-[#0B1E3F] tabular-nums inline-flex items-center gap-1.5">
                <Image
                  src="/usdc.png"
                  alt="USDC"
                  width={20}
                  height={20}
                  className="rounded-full shrink-0"
                />
                {onchainUsdc !== null ? formatMoney(onchainUsdc) : "-"}
              </p>
              {!isApproved && (
                <p className="text-xs text-[#7C8CA6] mt-1">Visible once KYB is approved</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-8 text-center text-sm text-[#7C8CA6]">
          No wallet has been provisioned for this organization yet.
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#0B1E3F]">Buckets</h2>
          <Link href="/wallet/transfers" className="text-sm font-medium text-[#2A5CE6] hover:underline">
            View transfers
          </Link>
        </div>
        {bucketBalances.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E5E9F2] bg-white px-5 py-6 text-center text-sm text-[#7C8CA6]">
            No buckets yet.
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E9F2] bg-white divide-y divide-[#F2F4F8]">
            {bucketBalances.map((b) => (
              <Link
                key={b.id}
                href={`/buckets/${b.id}`}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[#0B1E3F]">{b.name}</span>
                  <StatusPill value={b.type} />
                </div>
                <span className="text-sm font-semibold text-[#0B1E3F] tabular-nums">
                  {formatMoney(b.balance)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const sendBtnStyle = {
  "--btn-bg": "#2A5CE6",
  "--btn-bg-hover": "#2450d1",
  "--btn-edge": "#1A3FA8",
  "--btn-edge-hover": "#17358f",
  color: "#ffffff",
} as React.CSSProperties;