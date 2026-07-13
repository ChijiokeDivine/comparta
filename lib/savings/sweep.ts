// lib/savings/sweep.ts
//
// Fires SavingsRule the same way lib/allocationRules/engine.ts fires
// AllocationRule — this module is the ONLY place that actually moves
// money because of a SavingsRule. Three entry points, one per trigger:
//
//   - executeIncomingPaymentSavingsRules(): called from
//     lib/transfers/receive.ts AFTER an inbound payment has been
//     credited, for every active PERCENTAGE_OF_INCOME rule sourced from
//     that bucket. Mirrors executeIncomingPaymentAllocationRules exactly.
//   - executeOutgoingPaymentSavingsRules(): called from
//     lib/transfers/send.ts AFTER an outbound payment has been debited,
//     for every active ROUND_UP rule sourced from that bucket. This is
//     the one trigger AllocationRule has no equivalent for — a round-up
//     rule only makes sense reacting to money LEAVING a bucket, not
//     arriving.
//   - runScheduledSavingsRules(): called from a daily worker (see
//     jobs/workers/savingsSweep.worker.ts) for every active
//     FIXED_RECURRING rule whose cron says it's due.
//
// Same "runs after the triggering transaction has already committed"
// posture as AllocationRule, and for the same reason: a savings sweep
// failing (floor-protected, insufficient balance) must never take the
// payment that triggered it down with it. Multiple rules on the same
// source execute sequentially, not in parallel, for the same reason
// lib/allocationRules/engine.ts does — a floor/balance-constrained rule's
// outcome depends on the balance left behind by any rule that ran before
// it.
//
// Floor protection: every sweep amount is clamped so the SOURCE bucket's
// balance never drops below LedgerAccount.minimumBalanceFloor. A sweep
// that would otherwise move $50 but the floor only allows $30 moves $30,
// not $0 and not $50 — never silently skipped when a partial sweep is
// still meaningful. A sweep clamped to exactly $0 is logged as
// SKIPPED_FLOOR_PROTECTED, not FAILED — this isn't an error condition,
// it's the floor doing its job.
//
// Yield deployment: after a successful sweep INTO a bucket with
// isYieldEnabled=true, this module immediately calls
// lib/savings/yield.ts#deployToYield for yieldAllocationPct of the
// amount JUST swept in — never of the bucket's whole balance. Only the
// fresh inflow is deployed, so a manual internal transfer someone parked
// in the bucket outside of a savings rule is left alone rather than
// being auto-deployed out from under them.

import { prisma } from "@/lib/db/prisma";
import { nanoid } from "nanoid";
import {
  transferBetweenLedgerAccounts,
  InsufficientBalanceError,
  getBalance,
} from "@/lib/ledger/engine";
import { deployToYield } from "./yield";
import type { SavingsRule, LedgerReferenceType } from "@/app/generated/prisma/client";

const BASIS_POINTS_SCALE = 10000n;

export interface SavingsExecutionSummary {
  ruleId: string;
  status: "EXECUTED" | "SKIPPED_ZERO_AMOUNT" | "SKIPPED_FLOOR_PROTECTED" | "FAILED";
  amountSwept: bigint;
  yieldPositionId?: string;
  errorMessage?: string;
}

/** Clamps `requestedAmount` so `currentBalance - result >= floor`, never negative. */
function computeFloorConstrainedAmount(
  currentBalance: bigint,
  requestedAmount: bigint,
  floor: bigint
): bigint {
  const maxWithdrawable = currentBalance - floor;
  if (maxWithdrawable <= 0n) return 0n;
  return requestedAmount < maxWithdrawable ? requestedAmount : maxWithdrawable;
}

async function recordExecution(
  savingsRuleId: string,
  triggerReferenceType: LedgerReferenceType,
  triggerReferenceId: string,
  status: SavingsExecutionSummary["status"],
  amountSwept: bigint,
  ledgerReferenceId?: string,
  errorMessage?: string,
  yieldPositionId?: string
): Promise<SavingsExecutionSummary> {
  await prisma.savingsRuleExecution
    .create({
      data: {
        savingsRuleId,
        triggerReferenceType,
        triggerReferenceId,
        amountSwept,
        status,
        ledgerReferenceId,
        errorMessage,
        yieldPositionId,
      },
    })
    .catch((logErr) =>
      console.error(`[savings] failed to log execution for rule ${savingsRuleId}`, logErr)
    );

  return { ruleId: savingsRuleId, status, amountSwept, yieldPositionId, errorMessage };
}

async function executeSingleRule(
  rule: SavingsRule,
  requestedAmount: bigint,
  triggerReferenceType: LedgerReferenceType,
  triggerReferenceId: string
): Promise<SavingsExecutionSummary> {
  const sourceBucket = await prisma.ledgerAccount.findUnique({
    where: { id: rule.sourceLedgerAccountId },
  });
  if (!sourceBucket) {
    return recordExecution(
      rule.id,
      triggerReferenceType,
      triggerReferenceId,
      "FAILED",
      0n,
      undefined,
      "Source bucket not found."
    );
  }

  const currentBalance = await getBalance(rule.sourceLedgerAccountId);
  const amount = computeFloorConstrainedAmount(
    currentBalance,
    requestedAmount,
    sourceBucket.minimumBalanceFloor
  );

  if (amount <= 0n) {
    const status = requestedAmount <= 0n ? "SKIPPED_ZERO_AMOUNT" : "SKIPPED_FLOOR_PROTECTED";
    return recordExecution(rule.id, triggerReferenceType, triggerReferenceId, status, 0n);
  }

  const ledgerReferenceId = nanoid();

  try {
    await transferBetweenLedgerAccounts(
      rule.sourceLedgerAccountId,
      rule.targetLedgerAccountId,
      amount,
      "SAVINGS_SWEEP",
      ledgerReferenceId
    );

    await prisma.savingsRule.update({ where: { id: rule.id }, data: { lastExecutedAt: new Date() } });

    // Deploy a slice into USYC if the target bucket has yield enabled.
    // Best-effort and non-blocking for the sweep's own success: a deploy
    // failure leaves the funds sitting liquid in the savings bucket
    // (still fully credited, still fully the org's money) rather than
    // failing the whole sweep — see lib/savings/yield.ts#deployToYield
    // for how it reverses cleanly on its own failure.
    let yieldPositionId: string | undefined;
    const targetBucket = await prisma.ledgerAccount.findUnique({
      where: { id: rule.targetLedgerAccountId },
    });
    if (targetBucket?.isYieldEnabled && targetBucket.yieldAllocationPct) {
      const deployAmount = (amount * BigInt(targetBucket.yieldAllocationPct)) / BASIS_POINTS_SCALE;
      if (deployAmount > 0n) {
        try {
          const deployResult = await deployToYield({
            orgId: rule.orgId,
            ledgerAccountId: rule.targetLedgerAccountId,
            amount: deployAmount,
            referenceType: "SAVINGS_SWEEP",
            referenceId: ledgerReferenceId,
          });
          yieldPositionId = deployResult.yieldPosition.id;
        } catch (err) {
          console.error(
            `[savings] deploy-to-yield failed after sweep for rule ${rule.id} ` +
              `(funds remain liquid in the savings bucket)`,
            err
          );
        }
      }
    }

    return recordExecution(
      rule.id,
      triggerReferenceType,
      triggerReferenceId,
      "EXECUTED",
      amount,
      ledgerReferenceId,
      undefined,
      yieldPositionId
    );
  } catch (err) {
    const message =
      err instanceof InsufficientBalanceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error executing savings rule";
    console.error(`[savings] rule ${rule.id} failed to execute`, err);
    return recordExecution(rule.id, triggerReferenceType, triggerReferenceId, "FAILED", 0n, undefined, message);
  }
}

// ── PERCENTAGE_OF_INCOME (inbound trigger) ──────────────────────────────

export interface ExecuteIncomingPaymentSavingsRulesParams {
  orgId: string;
  sourceLedgerAccountId: string;
  /** The amount that was just credited to sourceLedgerAccountId — PERCENTAGE_OF_INCOME rules are computed against this, not the account's resulting balance. */
  creditedAmount: bigint;
  triggerReferenceType: LedgerReferenceType;
  triggerReferenceId: string;
}

/**
 * Call this AFTER committing the transaction that credited an inbound
 * payment to sourceLedgerAccountId. Fire-and-forget-safe: never throws —
 * failures are logged to SavingsRuleExecution and returned in the
 * summary, not propagated. Intended call site: lib/transfers/receive.ts,
 * alongside executeIncomingPaymentAllocationRules.
 */
export async function executeIncomingPaymentSavingsRules(
  params: ExecuteIncomingPaymentSavingsRulesParams
): Promise<SavingsExecutionSummary[]> {
  const rules = await prisma.savingsRule.findMany({
    where: {
      orgId: params.orgId,
      sourceLedgerAccountId: params.sourceLedgerAccountId,
      trigger: "PERCENTAGE_OF_INCOME",
      active: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const summaries: SavingsExecutionSummary[] = [];
  for (const rule of rules) {
    // rule.value = basis points for this trigger (see lib/savings/service.ts#parseValueForTrigger).
    const amount = (params.creditedAmount * rule.value) / BASIS_POINTS_SCALE;
    summaries.push(
      await executeSingleRule(rule, amount, params.triggerReferenceType, params.triggerReferenceId)
    );
  }
  return summaries;
}

// ── ROUND_UP (outbound trigger) ─────────────────────────────────────────

export interface ExecuteOutgoingPaymentSavingsRulesParams {
  orgId: string;
  sourceLedgerAccountId: string;
  /** The amount that was just debited from sourceLedgerAccountId. */
  debitedAmount: bigint;
  triggerReferenceType: LedgerReferenceType;
  triggerReferenceId: string;
}

/**
 * Call this AFTER committing the transaction that debited an outbound
 * payment from sourceLedgerAccountId. Fire-and-forget-safe: never throws.
 * Intended call site: lib/transfers/send.ts#sendPayment, right after its
 * ledger debit succeeds.
 */
export async function executeOutgoingPaymentSavingsRules(
  params: ExecuteOutgoingPaymentSavingsRulesParams
): Promise<SavingsExecutionSummary[]> {
  const rules = await prisma.savingsRule.findMany({
    where: {
      orgId: params.orgId,
      sourceLedgerAccountId: params.sourceLedgerAccountId,
      trigger: "ROUND_UP",
      active: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const summaries: SavingsExecutionSummary[] = [];
  for (const rule of rules) {
    const roundUpUnit = rule.value; // smallest USDC unit — see lib/savings/service.ts#parseValueForTrigger
    if (roundUpUnit <= 0n) continue;

    const remainder = params.debitedAmount % roundUpUnit;
    // A payment that already lands on an exact multiple has nothing to
    // round up — 0, not roundUpUnit (never sweep a "round up" on a
    // payment that needed no rounding).
    const amount = remainder === 0n ? 0n : roundUpUnit - remainder;

    summaries.push(
      await executeSingleRule(rule, amount, params.triggerReferenceType, params.triggerReferenceId)
    );
  }
  return summaries;
}

// ── FIXED_RECURRING (scheduled trigger) ─────────────────────────────────

// Minimal due-check, matching lib/allocationRules/engine.ts#isScheduledRuleDue
// exactly: "has at least a day passed since this rule last ran (or since
// creation, if never run)". Day-granularity only, since this is meant to
// run from a once-daily worker — see that module's comment for the
// rationale, which applies identically here.
function isScheduledRuleDue(rule: SavingsRule, now: Date): boolean {
  if (!rule.lastExecutedAt) return true;
  const msSinceLastRun = now.getTime() - rule.lastExecutedAt.getTime();
  return msSinceLastRun >= 23 * 60 * 60 * 1000;
}

export interface RunScheduledSavingsRulesResult {
  rulesEvaluated: number;
  summaries: SavingsExecutionSummary[];
}

/** Called by jobs/workers/savingsSweep.worker.ts (daily). Sweeps a fixed amount for each due FIXED_RECURRING rule, floor-clamped same as every other trigger. */
export async function runScheduledSavingsRules(
  now = new Date()
): Promise<RunScheduledSavingsRulesResult> {
  const rules = await prisma.savingsRule.findMany({
    where: { trigger: "FIXED_RECURRING", active: true },
    orderBy: [{ sourceLedgerAccountId: "asc" }, { createdAt: "asc" }],
  });

  const dueRules = rules.filter((rule) => isScheduledRuleDue(rule, now));
  const summaries: SavingsExecutionSummary[] = [];

  for (const rule of dueRules) {
    const jobRunId = `scheduled-savings-sweep-${now.toISOString().slice(0, 10)}`;
    summaries.push(await executeSingleRule(rule, rule.value, "SAVINGS_SWEEP", jobRunId));
  }

  return { rulesEvaluated: dueRules.length, summaries };
}