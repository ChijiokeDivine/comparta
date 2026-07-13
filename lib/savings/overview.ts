// lib/savings/overview.ts
//
// Read-model composition for a single yield-enabled bucket: liquid vs.
// deployed balance split, accrued yield to date, and a simple monthly
// projection at the current published rate. Shaped so an API route can
// return this object directly with no further reshaping needed by the
// UI layer — same "return exactly what a detail view wants" posture as
// lib/buckets/service.ts#getBucketDetail.
//
// This module never mutates anything (all reads) — money movement lives
// in lib/savings/sweep.ts and lib/savings/yield.ts.

import { prisma } from "@/lib/db/prisma";
import { getBalance } from "@/lib/ledger/engine";
import { toDecimalString } from "@/lib/circle/amount";
import { getBucket } from "@/lib/buckets/service";
import { usycToUsdc } from "./yield";
import { getCachedUsycNav, getCachedUsycYieldRate } from "./yieldRate";
import type { YieldPositionStatus } from "@/app/generated/prisma/client";

export interface YieldPositionSummary {
  id: string;
  usycAmount: string; // decimal string, USYC units
  usdcEquivalentAtDeploy: string; // decimal string, cost basis
  currentUsdcValue: string; // decimal string, at today's cached NAV
  accruedYield: string; // currentUsdcValue - usdcEquivalentAtDeploy
  status: YieldPositionStatus;
  deployedAt: Date;
  redeemedAt: Date | null;
}

export interface PendingRedemptionSummary {
  id: string;
  usycAmountRequested: string;
  status: string;
  createdAt: Date;
}

export interface SavingsBucketOverview {
  ledgerAccountId: string;
  isYieldEnabled: boolean;
  yieldAllocationPct: number | null; // basis points, e.g. 8000 = 80%
  minimumBalanceFloor: string; // decimal string
  liquidBalance: string; // decimal string — spendable now, identical to getBalance()
  deployedBalance: string; // decimal string — sum of ACTIVE positions' currentUsdcValue
  totalBalance: string; // liquidBalance + deployedBalance
  accruedYieldToDate: string; // sum of ACTIVE positions' accruedYield
  currentApyBps: number;
  currentApyAsOf: Date;
  /**
   * Simple projection: deployedBalance * currentApy / 12. Assumes the
   * deployed balance and rate both hold steady for a month — a
   * projection, not a guarantee, and should be labeled as such wherever
   * it's surfaced.
   */
  projectedMonthlyYield: string;
  activePositions: YieldPositionSummary[];
  pendingRedemptions: PendingRedemptionSummary[];
}

export async function getSavingsBucketOverview(
  orgId: string,
  ledgerAccountId: string
): Promise<SavingsBucketOverview> {
  const bucket = await getBucket(orgId, ledgerAccountId);

  const [liquidBalance, positions, pendingRedemptions, nav, yieldRate] = await Promise.all([
    getBalance(ledgerAccountId),
    prisma.yieldPosition.findMany({ where: { ledgerAccountId, status: "ACTIVE" }, orderBy: { deployedAt: "asc" } }),
    prisma.yieldRedemptionRequest.findMany({
      where: { ledgerAccountId, status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
    }),
    getCachedUsycNav(),
    getCachedUsycYieldRate(),
  ]);

  let deployedBalance = 0n;
  let accruedYieldToDate = 0n;

  const activePositions: YieldPositionSummary[] = positions.map((p) => {
    const currentValue = usycToUsdc(p.usycAmount, nav.navPerShare);
    const accrued = currentValue - p.usdcEquivalentAtDeploy;
    deployedBalance += currentValue;
    accruedYieldToDate += accrued;

    return {
      id: p.id,
      usycAmount: toDecimalString(p.usycAmount),
      usdcEquivalentAtDeploy: toDecimalString(p.usdcEquivalentAtDeploy),
      currentUsdcValue: toDecimalString(currentValue),
      accruedYield: toDecimalString(accrued),
      status: p.status,
      deployedAt: p.deployedAt,
      redeemedAt: p.redeemedAt,
    };
  });

  const projectedMonthlyYield = (deployedBalance * BigInt(yieldRate.apyBps)) / 10000n / 12n;

  return {
    ledgerAccountId,
    isYieldEnabled: bucket.isYieldEnabled,
    yieldAllocationPct: bucket.yieldAllocationPct,
    minimumBalanceFloor: toDecimalString(bucket.minimumBalanceFloor),
    liquidBalance: toDecimalString(liquidBalance),
    deployedBalance: toDecimalString(deployedBalance),
    totalBalance: toDecimalString(liquidBalance + deployedBalance),
    accruedYieldToDate: toDecimalString(accruedYieldToDate),
    currentApyBps: yieldRate.apyBps,
    currentApyAsOf: yieldRate.asOf,
    projectedMonthlyYield: toDecimalString(projectedMonthlyYield),
    activePositions,
    pendingRedemptions: pendingRedemptions.map((r) => ({
      id: r.id,
      usycAmountRequested: toDecimalString(r.usycAmountRequested),
      status: r.status,
      createdAt: r.createdAt,
    })),
  };
}

export interface YieldHistoryPoint {
  date: string; // "YYYY-MM-DD"
  deployedValue: string; // decimal string
  accruedYield: string; // decimal string
}

/**
 * Yield-history series for a chart — one point per day. Derived from
 * YieldPosition rows directly rather than a separate time-series table:
 * each position's value grows monotonically from its deploy-time cost
 * basis to its current NAV-implied value, so this linearly interpolates
 * that path for days in between (exact at "today", approximate for the
 * shape of the curve in between).
 *
 * NOTE: this is a simplified reconstruction, not a true historical NAV
 * series. Once Circle exposes a USYC NAV-history endpoint, swap the
 * per-day interpolation below for real historical NAV lookups — nothing
 * else in this module needs to change (the function signature and
 * return shape stay the same).
 */
export async function getYieldHistory(
  orgId: string,
  ledgerAccountId: string,
  days = 30
): Promise<YieldHistoryPoint[]> {
  await getBucket(orgId, ledgerAccountId); // ownership check — throws BucketNotFoundError if not owned

  const [positions, nav] = await Promise.all([
    prisma.yieldPosition.findMany({ where: { ledgerAccountId } }),
    getCachedUsycNav(),
  ]);

  const now = new Date();
  const points: YieldHistoryPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    let deployedValue = 0n;
    let accrued = 0n;

    for (const p of positions) {
      if (p.deployedAt > day) continue; // not yet deployed as of this day
      if (p.redeemedAt && p.redeemedAt <= day) continue; // fully redeemed by this day

      const totalAgeMs = Math.max(now.getTime() - p.deployedAt.getTime(), 1);
      const ageAtDayMs = day.getTime() - p.deployedAt.getTime();
      const fractionElapsed = Math.min(Math.max(ageAtDayMs / totalAgeMs, 0), 1);

      const currentValue = usycToUsdc(p.usycAmount, nav.navPerShare);
      const totalAccrued = currentValue - p.usdcEquivalentAtDeploy;
      const accruedAtDay = BigInt(Math.round(Number(totalAccrued) * fractionElapsed));

      deployedValue += p.usdcEquivalentAtDeploy + accruedAtDay;
      accrued += accruedAtDay;
    }

    points.push({
      date: day.toISOString().slice(0, 10),
      deployedValue: toDecimalString(deployedValue),
      accruedYield: toDecimalString(accrued),
    });
  }

  return points;
}