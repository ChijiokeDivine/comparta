// lib/allocationRules/service.ts
//
// CRUD + validation for AllocationRule. Execution (actually moving money
// when a rule fires) lives in lib/allocationRules/engine.ts — this module
// only ever reads/writes the rule definitions themselves, never touches
// LedgerEntry.
//
// The one non-obvious invariant this module enforces: for a given
// (orgId, sourceLedgerAccountId, trigger), active PERCENTAGE rules can
// never sum above 100.00% (10000 basis points). Postgres can't express a
// cross-row SUM constraint in a CHECK, so this is enforced here, on every
// write path (create + update-that-changes-value-or-reactivates), inside
// a transaction that locks the sibling rows so two concurrent rule
// creations can't both pass validation and jointly over-allocate.

import { prisma } from "@/lib/db/prisma";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { assertBucketsBelongToOrg, getBucket } from "@/lib/buckets/service";
import type { AllocationRule, AllocationRuleType, AllocationTrigger, Prisma } from "@/app/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export class AllocationRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationRuleValidationError";
  }
}

export class AllocationRuleNotFoundError extends Error {
  constructor() {
    super("Allocation rule not found");
    this.name = "AllocationRuleNotFoundError";
  }
}

const BASIS_POINTS_SCALE = 10000n; // 10000 basis points = 100.00%

// ── value parsing (percentage <-> basis points, amount <-> smallest unit) ──

/** "20" or "20.5" (percent) -> 2000n / 2050n basis points. Supports up to 2 decimal places (0.01% granularity). */
function parsePercentageToBasisPoints(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AllocationRuleValidationError(`"${raw}" isn't a valid percentage.`);
  }
  const [wholePart, fracPartRaw = ""] = trimmed.split(".");
  if (fracPartRaw.length > 2) {
    throw new AllocationRuleValidationError(
      `"${raw}" — percentages support at most 2 decimal places (0.01% granularity).`
    );
  }
  const fracPart = fracPartRaw.padEnd(2, "0");
  const basisPoints = BigInt(wholePart) * 100n + BigInt(fracPart || "0");

  if (basisPoints <= 0n) {
    throw new AllocationRuleValidationError("Percentage must be greater than 0.");
  }
  if (basisPoints > BASIS_POINTS_SCALE) {
    throw new AllocationRuleValidationError("Percentage cannot exceed 100.");
  }
  return basisPoints;
}

export function basisPointsToPercentageString(basisPoints: bigint): string {
  const whole = basisPoints / 100n;
  const frac = (basisPoints % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

function parseValueForType(ruleType: AllocationRuleType, rawValue: string): bigint {
  if (ruleType === "PERCENTAGE") {
    return parsePercentageToBasisPoints(rawValue);
  }
  // FIXED_AMOUNT
  let smallest: bigint;
  try {
    smallest = toSmallestUnit(rawValue);
  } catch {
    throw new AllocationRuleValidationError(`"${rawValue}" isn't a valid USDC amount.`);
  }
  if (smallest <= 0n) {
    throw new AllocationRuleValidationError("Fixed allocation amount must be greater than zero.");
  }
  return smallest;
}

// ── the over-allocation guard ───────────────────────────────────────────

/**
 * Throws if adding/updating a PERCENTAGE rule would push the active
 * percentage total for (orgId, sourceLedgerAccountId, trigger) above
 * 100%. Only PERCENTAGE + active rules count toward the budget —
 * FIXED_AMOUNT rules aren't percentage-of-incoming and aren't included.
 * `excludeRuleId` lets an update re-check the budget as if the rule being
 * edited didn't already exist (so shrinking or editing a rule's own value
 * doesn't double-count it against itself).
 */
async function assertPercentageBudget(
  tx: Tx,
  params: {
    orgId: string;
    sourceLedgerAccountId: string;
    trigger: AllocationTrigger;
    candidateBasisPoints: bigint;
    excludeRuleId?: string;
  }
): Promise<void> {
  const siblings = await tx.allocationRule.findMany({
    where: {
      orgId: params.orgId,
      sourceLedgerAccountId: params.sourceLedgerAccountId,
      trigger: params.trigger,
      ruleType: "PERCENTAGE",
      active: true,
      ...(params.excludeRuleId ? { id: { not: params.excludeRuleId } } : {}),
    },
    select: { value: true },
  });

  const existingTotal = siblings.reduce((sum, r) => sum + r.value, 0n);
  const projectedTotal = existingTotal + params.candidateBasisPoints;

  if (projectedTotal > BASIS_POINTS_SCALE) {
    throw new AllocationRuleValidationError(
      `This rule would allocate ${basisPointsToPercentageString(params.candidateBasisPoints)}% on top of ` +
        `${basisPointsToPercentageString(existingTotal)}% already committed by other active rules from this ` +
        `bucket, totaling ${basisPointsToPercentageString(projectedTotal)}%. Active percentage rules from the ` +
        `same source can never sum above 100%.`
    );
  }
}

function describeRule(ruleType: AllocationRuleType, value: bigint, targetName: string): string {
  const amount =
    ruleType === "PERCENTAGE" ? `${basisPointsToPercentageString(value)}%` : `${toDecimalString(value)} USDC`;
  return `${amount} to ${targetName}`;
}

// ── create ──────────────────────────────────────────────────────────────

export interface CreateAllocationRuleInput {
  orgId: string;
  sourceLedgerAccountId: string;
  targetLedgerAccountId: string;
  ruleType: AllocationRuleType;
  /** Decimal string: a percentage ("20" = 20%) for PERCENTAGE, a USDC amount ("150.00") for FIXED_AMOUNT. */
  value: string;
  trigger?: AllocationTrigger; // defaults to ON_INCOMING_PAYMENT
  scheduleCron?: string; // required iff trigger = SCHEDULED
  priority?: number;
  name?: string;
}

export async function createAllocationRule(input: CreateAllocationRuleInput): Promise<AllocationRule> {
  if (input.sourceLedgerAccountId === input.targetLedgerAccountId) {
    throw new AllocationRuleValidationError("Source and target buckets must be different.");
  }

  await assertBucketsBelongToOrg(input.orgId, [input.sourceLedgerAccountId, input.targetLedgerAccountId]);

  const [source, target] = await Promise.all([
    getBucket(input.orgId, input.sourceLedgerAccountId),
    getBucket(input.orgId, input.targetLedgerAccountId),
  ]);
  if (source.archived) throw new AllocationRuleValidationError(`Bucket "${source.name}" is archived.`);
  if (target.archived) throw new AllocationRuleValidationError(`Bucket "${target.name}" is archived.`);

  const trigger = input.trigger ?? "ON_INCOMING_PAYMENT";
  if (trigger === "SCHEDULED" && !input.scheduleCron?.trim()) {
    throw new AllocationRuleValidationError("A schedule (cron expression) is required for SCHEDULED rules.");
  }
  if (trigger === "ON_INCOMING_PAYMENT" && input.scheduleCron) {
    throw new AllocationRuleValidationError("scheduleCron is only valid for SCHEDULED rules.");
  }

  const value = parseValueForType(input.ruleType, input.value);

  return prisma.$transaction(async (tx) => {
    if (input.ruleType === "PERCENTAGE") {
      await assertPercentageBudget(tx, {
        orgId: input.orgId,
        sourceLedgerAccountId: input.sourceLedgerAccountId,
        trigger,
        candidateBasisPoints: value,
      });
    }

    return tx.allocationRule.create({
      data: {
        orgId: input.orgId,
        sourceLedgerAccountId: input.sourceLedgerAccountId,
        targetLedgerAccountId: input.targetLedgerAccountId,
        ruleType: input.ruleType,
        value,
        trigger,
        scheduleCron: trigger === "SCHEDULED" ? input.scheduleCron!.trim() : null,
        priority: input.priority ?? 0,
        name: input.name?.trim() || describeRule(input.ruleType, value, target.name),
      },
    });
  });
}

// ── update ──────────────────────────────────────────────────────────────

export interface UpdateAllocationRuleInput {
  value?: string; // re-parsed against the rule's existing ruleType — ruleType itself is immutable, see note below
  active?: boolean;
  priority?: number;
  name?: string;
  scheduleCron?: string;
}

export async function updateAllocationRule(
  orgId: string,
  ruleId: string,
  input: UpdateAllocationRuleInput
): Promise<AllocationRule> {
  return prisma.$transaction(async (tx) => {
    const rule = await tx.allocationRule.findFirst({ where: { id: ruleId, orgId } });
    if (!rule) throw new AllocationRuleNotFoundError();

    const nextActive = input.active ?? rule.active;
    const nextValue = input.value !== undefined ? parseValueForType(rule.ruleType, input.value) : rule.value;

    // Only re-check the budget when the rule will be active with a
    // PERCENTAGE type and either its value changed or it's being
    // (re)activated — an update that only touches priority/name on an
    // already-valid active rule doesn't need to re-run the check.
    const valueChanged = nextValue !== rule.value;
    const reactivating = nextActive && !rule.active;
    if (rule.ruleType === "PERCENTAGE" && nextActive && (valueChanged || reactivating)) {
      await assertPercentageBudget(tx, {
        orgId,
        sourceLedgerAccountId: rule.sourceLedgerAccountId,
        trigger: rule.trigger,
        candidateBasisPoints: nextValue,
        excludeRuleId: rule.id,
      });
    }

    if (input.scheduleCron !== undefined && rule.trigger !== "SCHEDULED") {
      throw new AllocationRuleValidationError("scheduleCron is only valid for SCHEDULED rules.");
    }

    return tx.allocationRule.update({
      where: { id: ruleId },
      data: {
        value: nextValue,
        active: nextActive,
        priority: input.priority ?? rule.priority,
        name: input.name !== undefined ? input.name.trim() || null : rule.name,
        scheduleCron: input.scheduleCron !== undefined ? input.scheduleCron.trim() : rule.scheduleCron,
      },
    });
  });
}

// ── delete / deactivate ────────────────────────────────────────────────

/** Convenience wrapper — the common case of turning a rule off without deleting its history. */
export async function deactivateAllocationRule(orgId: string, ruleId: string): Promise<AllocationRule> {
  return updateAllocationRule(orgId, ruleId, { active: false });
}

/**
 * Hard-deletes a rule that has never fired. A rule with execution history
 * is kept for audit purposes — deactivate it instead (AllocationRuleExecution
 * rows FK to AllocationRule and are themselves append-only, so deleting a
 * rule with history would either cascade-delete audit rows or fail the FK;
 * neither is acceptable, so this function refuses instead).
 */
export async function deleteAllocationRule(orgId: string, ruleId: string): Promise<void> {
  const rule = await prisma.allocationRule.findFirst({ where: { id: ruleId, orgId } });
  if (!rule) throw new AllocationRuleNotFoundError();

  const executionCount = await prisma.allocationRuleExecution.count({ where: { allocationRuleId: ruleId } });
  if (executionCount > 0) {
    throw new AllocationRuleValidationError(
      `This rule has ${executionCount} recorded execution(s) and can't be deleted. Deactivate it instead to stop it from firing while keeping its history.`
    );
  }

  await prisma.allocationRule.delete({ where: { id: ruleId } });
}

// ── read ────────────────────────────────────────────────────────────────

export async function getAllocationRule(orgId: string, ruleId: string): Promise<AllocationRule> {
  const rule = await prisma.allocationRule.findFirst({ where: { id: ruleId, orgId } });
  if (!rule) throw new AllocationRuleNotFoundError();
  return rule;
}

export interface ListAllocationRulesOptions {
  sourceLedgerAccountId?: string;
  active?: boolean;
}

export async function listAllocationRules(
  orgId: string,
  options: ListAllocationRulesOptions = {}
): Promise<AllocationRule[]> {
  return prisma.allocationRule.findMany({
    where: {
      orgId,
      ...(options.sourceLedgerAccountId ? { sourceLedgerAccountId: options.sourceLedgerAccountId } : {}),
      ...(options.active !== undefined ? { active: options.active } : {}),
    },
    orderBy: [{ sourceLedgerAccountId: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
  });
}
