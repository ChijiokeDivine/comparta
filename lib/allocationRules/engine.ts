// lib/allocationRules/engine.ts
//
// The ONLY module that actually fires an AllocationRule (moves money
// because of one). Two entry points:
//
//   - executeIncomingPaymentAllocationRules(): called from
//     lib/transfers/receive.ts AFTER an inbound payment has been credited
//     to a bucket, for every active ON_INCOMING_PAYMENT rule sourced from
//     that bucket.
//   - runScheduledAllocationRules(): called from a daily worker (see
//     jobs/workers/allocationRulesScheduled.worker.ts) for every active
//     SCHEDULED rule whose cron says it's due, sweeping a percentage/
//     fixed-amount slice of the source bucket's CURRENT balance rather
//     than of an incoming payment.
//
// Deliberate design choice — why this runs OUTSIDE the transaction that
// credited the source bucket, not nested inside it:
//
//   lib/ledger/engine.ts's transferBetweenLedgerAccounts() now accepts an
//   externalTx so it CAN be composed into an existing transaction — but a
//   failed rule (e.g. InsufficientBalanceError on a FIXED_AMOUNT rule)
//   would abort that shared Postgres transaction, taking the inbound
//   payment's own credit down with it. Crediting the inbound payment must
//   never depend on an allocation rule succeeding. So this module always
//   runs after the triggering transaction has already committed, and each
//   rule gets its own small transaction — one rule failing never affects
//   another rule or the payment that triggered them. This mirrors how
//   receive.ts already treats invoice-paid notifications and wrong-amount
//   refunds as post-commit, best-effort follow-ups.
//
// Multiple rules on the same source execute sequentially (by priority,
// then creation order) — not in parallel — because a FIXED_AMOUNT rule's
// success depends on the balance left behind by any rule that ran before
// it.

import { prisma } from "@/lib/db/prisma";
import { nanoid } from "nanoid";
import { transferBetweenLedgerAccounts, InsufficientBalanceError, getBalance } from "@/lib/ledger/engine";
import type { AllocationRule, LedgerReferenceType } from "@/app/generated/prisma/client";

const BASIS_POINTS_SCALE = 10000n;

export interface AllocationExecutionSummary {
  ruleId: string;
  status: "EXECUTED" | "SKIPPED_ZERO_AMOUNT" | "FAILED";
  amountAllocated: bigint;
  errorMessage?: string;
}

function computeAllocationAmount(rule: Pick<AllocationRule, "ruleType" | "value">, baseAmount: bigint): bigint {
  if (rule.ruleType === "PERCENTAGE") {
    return (baseAmount * rule.value) / BASIS_POINTS_SCALE; // floor — never allocate more than the percentage implies
  }
  return rule.value; // FIXED_AMOUNT
}

async function executeSingleRule(
  rule: AllocationRule,
  baseAmount: bigint,
  triggerReferenceType: LedgerReferenceType,
  triggerReferenceId: string
): Promise<AllocationExecutionSummary> {
  const amount = computeAllocationAmount(rule, baseAmount);

  if (amount <= 0n) {
    await prisma.allocationRuleExecution.create({
      data: {
        allocationRuleId: rule.id,
        triggerReferenceType,
        triggerReferenceId,
        amountAllocated: 0n,
        status: "SKIPPED_ZERO_AMOUNT",
      },
    });
    return { ruleId: rule.id, status: "SKIPPED_ZERO_AMOUNT", amountAllocated: 0n };
  }

  const ledgerReferenceId = nanoid();

  try {
    await prisma.$transaction(async (tx) => {
      await transferBetweenLedgerAccounts(
        rule.sourceLedgerAccountId,
        rule.targetLedgerAccountId,
        amount,
        "ALLOCATION_RULE",
        ledgerReferenceId,
        tx
      );
      await tx.allocationRule.update({ where: { id: rule.id }, data: { lastExecutedAt: new Date() } });
      await tx.allocationRuleExecution.create({
        data: {
          allocationRuleId: rule.id,
          triggerReferenceType,
          triggerReferenceId,
          amountAllocated: amount,
          ledgerReferenceId,
          status: "EXECUTED",
        },
      });
    });
    return { ruleId: rule.id, status: "EXECUTED", amountAllocated: amount };
  } catch (err) {
    const message =
      err instanceof InsufficientBalanceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error executing allocation rule";

    console.error(`[allocationRules] rule ${rule.id} failed to execute`, err);

    await prisma.allocationRuleExecution
      .create({
        data: {
          allocationRuleId: rule.id,
          triggerReferenceType,
          triggerReferenceId,
          amountAllocated: 0n,
          status: "FAILED",
          errorMessage: message,
        },
      })
      .catch((logErr) => console.error(`[allocationRules] failed to log failure for rule ${rule.id}`, logErr));

    return { ruleId: rule.id, status: "FAILED", amountAllocated: 0n, errorMessage: message };
  }
}

export interface ExecuteIncomingPaymentAllocationRulesParams {
  orgId: string;
  sourceLedgerAccountId: string;
  /** The amount that was just credited to sourceLedgerAccountId — PERCENTAGE rules are computed against this, not the account's resulting balance. */
  creditedAmount: bigint;
  triggerReferenceType: LedgerReferenceType;
  triggerReferenceId: string;
}

/**
 * Call this AFTER committing the transaction that credited an inbound
 * payment to sourceLedgerAccountId. Fire-and-forget-safe: never throws —
 * failures are logged to AllocationRuleExecution and returned in the
 * summary, not propagated, so a caller can `.catch(console.error)` this
 * and move on (see lib/transfers/receive.ts for the intended call site).
 */
export async function executeIncomingPaymentAllocationRules(
  params: ExecuteIncomingPaymentAllocationRulesParams
): Promise<AllocationExecutionSummary[]> {
  const rules = await prisma.allocationRule.findMany({
    where: {
      orgId: params.orgId,
      sourceLedgerAccountId: params.sourceLedgerAccountId,
      trigger: "ON_INCOMING_PAYMENT",
      active: true,
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  const summaries: AllocationExecutionSummary[] = [];
  for (const rule of rules) {
    summaries.push(
      await executeSingleRule(rule, params.creditedAmount, params.triggerReferenceType, params.triggerReferenceId)
    );
  }
  return summaries;
}

// ── SCHEDULED trigger ───────────────────────────────────────────────────
//
// Minimal cron-due check: "has at least one full day passed since this
// rule last ran (or since it was created, if it's never run)". This
// intentionally does not implement full cron-field parsing (minute/hour
// granularity) — jobs/workers/allocationRulesScheduled.worker.ts is meant
// to run once daily, so day-granularity is all a daily worker can honor
// regardless of what the stored cron string says. If sub-daily scheduling
// becomes a real requirement, swap this for a proper cron library and run
// the worker more often; nothing else in this module needs to change.

function isScheduledRuleDue(rule: AllocationRule, now: Date): boolean {
  if (!rule.lastExecutedAt) return true;
  const msSinceLastRun = now.getTime() - rule.lastExecutedAt.getTime();
  return msSinceLastRun >= 23 * 60 * 60 * 1000; // >=23h guards against a worker that runs slightly early two days running
}

export interface RunScheduledAllocationRulesResult {
  rulesEvaluated: number;
  summaries: AllocationExecutionSummary[];
}

/** Called by jobs/workers/allocationRulesScheduled.worker.ts. Sweeps a percentage/fixed slice of each due SCHEDULED rule's CURRENT source balance (not an incoming-payment amount, since there isn't one). */
export async function runScheduledAllocationRules(now = new Date()): Promise<RunScheduledAllocationRulesResult> {
  const rules = await prisma.allocationRule.findMany({
    where: { trigger: "SCHEDULED", active: true },
    orderBy: [{ sourceLedgerAccountId: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
  });

  const dueRules = rules.filter((rule) => isScheduledRuleDue(rule, now));
  const summaries: AllocationExecutionSummary[] = [];

  for (const rule of dueRules) {
    const currentBalance = await getBalance(rule.sourceLedgerAccountId);
    const jobRunId = `scheduled-sweep-${now.toISOString().slice(0, 10)}`;
    summaries.push(await executeSingleRule(rule, currentBalance, "ALLOCATION_RULE", jobRunId));
  }

  return { rulesEvaluated: dueRules.length, summaries };
}
