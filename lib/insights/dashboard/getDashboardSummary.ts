// lib/insights/dashboard/getDashboardSummary.ts
//
// Single read-model composer for the authenticated dashboard (Tier 0 of
// the frontend build). Reuses existing, already-battle-tested helpers
// rather than re-deriving balances or yield math:
//   - lib/buckets/service.ts#listBucketsWithBalances for per-bucket balances
//   - lib/savings/yieldRate.ts + lib/savings/yield.ts for NAV-implied yield
// and adds the handful of dashboard-only aggregations (30d inflow/outflow,
// pending approvals, recent activity) directly against Prisma, scoped by
// orgId exactly the way lib/insights/dashboard/queries.ts does for its own
// aggregations.
//
// Everything here is read-only. Money amounts are returned as decimal
// strings (see lib/circle/amount.ts) - never floats.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString, toSmallestUnit } from "@/lib/circle/amount";
import { listBucketsWithBalances, type BucketSummary } from "@/lib/buckets/service";
import { usycToUsdc } from "@/lib/savings/yield";
import { getCachedUsycNav } from "@/lib/savings/yieldRate";
import {
  valueUsdcInPreferredCurrency,
  type FiatValuationResult,
} from "@/lib/fx/valuation";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DashboardKpis {
  liquidBalance: string; // decimal string - sum of non-archived bucket balances
  deployedBalance: string; // decimal string - NAV-implied value of ACTIVE yield positions
  totalBalance: string; // liquidBalance + deployedBalance
  inflow30d: string;
  outflow30d: string;
  netYieldAccrued: string; // deployedBalance - cost basis, across ACTIVE positions
  /** True if there are ACTIVE yield positions but the live NAV couldn't be
   * fetched (e.g. Circle's USYC endpoint erroring) - deployedBalance and
   * netYieldAccrued above fall back to cost basis (no markup) in that
   * case, so the UI should hint the figure may be stale rather than
   * presenting it as precise. */
  yieldDataStale: boolean;
  pendingPayrollApprovals: number;
  overdueInvoices: number;
}

export interface ActivityItem {
  id: string;
  kind:
    | "onchain_in"
    | "onchain_out"
    | "invoice_event"
    | "payroll_run"
    | "payment_link_payment"
    | "savings_execution"
    | "allocation_execution";
  title: string;
  subtitle: string;
  amount: string | null; // decimal string, or null for non-monetary events
  status: string;
  createdAt: string; // ISO
}

export interface DashboardFiat {
  currency: string;
  supported: boolean;
  amount: string | null;
  rate: string | null;
  rateUpdatedAt: string | null;
  rateStatus: "fresh" | "stale" | "unavailable";
  symbol: string | null;
  currencyName: string | null;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  buckets: BucketSummary[];
  activity: ActivityItem[];
  fiat: DashboardFiat;
}

export async function getDashboardSummary(orgId: string): Promise<DashboardSummary> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY);

  const [
    buckets,
    activePositions,
    inflowAgg,
    outflowAgg,
    pendingPayrollApprovals,
    overdueInvoices,
    recentOnchain,
    recentInvoiceEvents,
    recentPayrollRuns,
    recentPaymentLinkPayments,
  ] = await Promise.all([
    listBucketsWithBalances(orgId, { includeSparkline: false }),
    prisma.yieldPosition.findMany({
      where: { status: "ACTIVE", ledgerAccount: { orgId } },
      select: { usycAmount: true, usdcEquivalentAtDeploy: true },
    }),
    prisma.onchainTransaction.aggregate({
      where: { wallet: { orgId }, direction: "IN", status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
    }),
    prisma.onchainTransaction.aggregate({
      where: { wallet: { orgId }, direction: "OUT", status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
    }),
    prisma.payrollRun.count({ where: { orgId, status: "PENDING_APPROVAL" } }),
    prisma.invoice.count({ where: { orgId, status: "OVERDUE" } }),
    prisma.onchainTransaction.findMany({
      where: { wallet: { orgId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        direction: true,
        amount: true,
        counterpartyAddress: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.invoiceEvent.findMany({
      where: { invoice: { orgId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        eventType: true,
        createdAt: true,
        invoice: { select: { id: true, recipientIdentifier: true, total: true } },
      },
    }),
    prisma.payrollRun.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, status: true, totalAmount: true, updatedAt: true },
    }),
    prisma.paymentLinkPayment.findMany({
      where: { paymentLink: { orgId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        payerIdentifier: true,
        amountPaid: true,
        amountExpected: true,
        status: true,
        createdAt: true,
        paymentLink: { select: { description: true, slug: true } },
      },
    }),
  ]);

  // ── balances ─────────────────────────────────────────────────────────
  // listBucketsWithBalances already returns exact decimal strings (see
  // lib/buckets/service.ts) - convert back through toSmallestUnit rather
  // than Number()/parseFloat() so we never lose precision on cents.
  const liquidBalance = buckets.reduce((sum, b) => sum + toSmallestUnit(b.balance), 0n);

  let deployedBalance = 0n;
  let costBasis = 0n;
  let yieldDataStale = false;

  if (activePositions.length > 0) {
    // Only hit Circle's USYC NAV endpoint when there's actually something
    // to value - and never let that call take the whole dashboard down
    // with it. A transient/misconfigured NAV endpoint (e.g. sandbox
    // returning 404) should degrade to "show cost basis, flag it as
    // stale" rather than an uncaught error crashing every other card on
    // the page.
    try {
      const nav = await getCachedUsycNav();
      for (const p of activePositions) {
        deployedBalance += usycToUsdc(p.usycAmount, nav.navPerShare);
        costBasis += p.usdcEquivalentAtDeploy;
      }
    } catch (err) {
      console.error("[dashboard] failed to fetch USYC NAV, falling back to cost basis", err);
      for (const p of activePositions) {
        deployedBalance += p.usdcEquivalentAtDeploy;
        costBasis += p.usdcEquivalentAtDeploy;
      }
      yieldDataStale = true;
    }
  }

  const netYieldAccrued = deployedBalance - costBasis;

  const kpis: DashboardKpis = {
    liquidBalance: toDecimalString(liquidBalance),
    deployedBalance: toDecimalString(deployedBalance),
    totalBalance: toDecimalString(liquidBalance + deployedBalance),
    inflow30d: toDecimalString(inflowAgg._sum.amount ?? 0n),
    outflow30d: toDecimalString(outflowAgg._sum.amount ?? 0n),
    netYieldAccrued: toDecimalString(netYieldAccrued < 0n ? 0n : netYieldAccrued),
    yieldDataStale,
    pendingPayrollApprovals,
    overdueInvoices,
  };

  // ── recent activity (merged + sorted) ───────────────────────────────
  const activity: ActivityItem[] = [
    ...recentOnchain.map((tx): ActivityItem => ({
      id: `onchain:${tx.id}`,
      kind: tx.direction === "IN" ? "onchain_in" : "onchain_out",
      title: tx.direction === "IN" ? "Payment received" : "Payment sent",
      subtitle: shortenAddress(tx.counterpartyAddress),
      amount: toDecimalString(tx.amount),
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
    })),
    ...recentInvoiceEvents.map((ev): ActivityItem => ({
      id: `invoice_event:${ev.id}`,
      kind: "invoice_event",
      title: invoiceEventLabel(ev.eventType),
      subtitle: ev.invoice.recipientIdentifier,
      amount: toDecimalString(ev.invoice.total),
      status: ev.eventType,
      createdAt: ev.createdAt.toISOString(),
    })),
    ...recentPayrollRuns.map((run): ActivityItem => ({
      id: `payroll_run:${run.id}`,
      kind: "payroll_run",
      title: "Payroll run",
      subtitle: payrollStatusLabel(run.status),
      amount: toDecimalString(run.totalAmount),
      status: run.status,
      createdAt: run.updatedAt.toISOString(),
    })),
    ...recentPaymentLinkPayments.map((p): ActivityItem => ({
      id: `payment_link_payment:${p.id}`,
      kind: "payment_link_payment",
      title: "Payment link payment",
      subtitle: p.paymentLink.description ?? `/pay/${p.paymentLink.slug}`,
      amount: toDecimalString(p.amountPaid ?? p.amountExpected),
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20);

  const totalMicroUsdc = liquidBalance + deployedBalance;
  const fiatVal = await valueUsdcInPreferredCurrency({
    orgId,
    usdcMicroAmount: totalMicroUsdc,
    now,
  });
  const fiat: DashboardFiat = {
    currency: fiatVal.currency,
    supported: fiatVal.supported,
    amount: fiatVal.amount,
    rate: fiatVal.rate,
    rateUpdatedAt: fiatVal.rateUpdatedAt,
    rateStatus: fiatVal.rateStatus,
    symbol: fiatVal.symbol,
    currencyName: fiatVal.currencyName,
  };

  return { kpis, buckets, activity, fiat };
}

function shortenAddress(address: string): string {
  if (address.startsWith("0x") && address.length > 12) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }
  return address;
}

function invoiceEventLabel(eventType: string): string {
  switch (eventType) {
    case "CREATED":
      return "Invoice created";
    case "SENT":
      return "Invoice sent";
    case "VIEWED":
      return "Invoice viewed";
    case "REMINDER_SENT":
      return "Reminder sent";
    case "PAID":
      return "Invoice paid";
    case "VOID":
      return "Invoice voided";
    default:
      return "Invoice updated";
  }
}

function payrollStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "PENDING_APPROVAL":
      return "Awaiting approval";
    case "PROCESSING":
      return "Processing";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}