// lib/savings/service.ts
//
// CRUD + validation for SavingsRule, plus enabling/configuring yield on a
// bucket (LedgerAccount.isYieldEnabled / yieldAllocationPct /
// minimumBalanceFloor). Execution (actually sweeping money, deploying to
// USYC) lives in lib/savings/sweep.ts and lib/savings/yield.ts — this
// module only ever reads/writes rule and bucket-config rows.
//
// Side-effect registration below: this feature's bucket-archive
// dependency checks (active SavingsRule referencing the bucket as
// source/target, ACTIVE YieldPosition still holding deployed capital)
// are registered against the shared registry in
// lib/buckets/dependencies.ts — same pattern
// lib/buckets/builtinDependencyCheckers.ts uses for its own checks (see
// that file's header for why the registration lives here instead of in
// lib/buckets/ itself: buckets/service.ts should never need to import
// this module).

import { prisma } from "@/lib/db/prisma";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { getBucket, assertBucketsBelongToOrg } from "@/lib/buckets/service";
import { registerBucketDependencyChecker } from "@/lib/buckets/dependencies";
import type { LedgerAccount, SavingsRule, SavingsRuleTrigger } from "@/app/generated/prisma/client";

registerBucketDependencyChecker(async (orgId, ledgerAccountId) => {
  const count = await prisma.savingsRule.count({
    where: {
      orgId,
      active: true,
      OR: [{ sourceLedgerAccountId: ledgerAccountId }, { targetLedgerAccountId: ledgerAccountId }],
    },
  });
  return count > 0 ? { label: `${count} active savings rule(s)`, count } : null;
});

registerBucketDependencyChecker(async (_orgId, ledgerAccountId) => {
  const count = await prisma.yieldPosition.count({ where: { ledgerAccountId, status: "ACTIVE" } });
  return count > 0
    ? { label: `${count} active USYC position(s) still deployed — redeem to USDC first`, count }
    : null;
});

export class SavingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavingsValidationError";
  }
}

export class SavingsRuleNotFoundError extends Error {
  constructor() {
    super("Savings rule not found");
    this.name = "SavingsRuleNotFoundError";
  }
}

const BASIS_POINTS_SCALE = 10000n;

// ── bucket yield configuration ──────────────────────────────────────────

export interface SetBucketYieldConfigInput {
  isYieldEnabled: boolean;
  /** "80" = deploy 80% of every fresh sweep into USYC, keep 20% liquid. Required iff isYieldEnabled=true. */
  yieldAllocationPct?: string;
  /** Decimal USDC string — the floor this bucket must never be swept below by a savings/allocation rule. Optional; omit to leave unchanged. */
  minimumBalanceFloor?: string;
}

function parsePercentageToBps(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new SavingsValidationError(`"${raw}" isn't a valid percentage.`);
  }
  const value = Number(trimmed);
  if (value <= 0 || value > 100) {
    throw new SavingsValidationError("Yield allocation percentage must be between 0 and 100.");
  }
  return Math.round(value * 100); // basis points
}

/**
 * Enables/disables yield on a bucket and/or updates its target USYC
 * allocation percentage and minimum balance floor. A bucket must have
 * yield enabled before any SavingsRule can target it — see
 * createSavingsRule below.
 */
export async function setBucketYieldConfig(
  orgId: string,
  ledgerAccountId: string,
  input: SetBucketYieldConfigInput
): Promise<LedgerAccount> {
  const bucket = await getBucket(orgId, ledgerAccountId);
  if (bucket.archived) throw new SavingsValidationError(`Bucket "${bucket.name}" is archived.`);

  let yieldAllocationPct: number | null = bucket.yieldAllocationPct;
  if (input.yieldAllocationPct !== undefined) {
    yieldAllocationPct = parsePercentageToBps(input.yieldAllocationPct);
  }
  if (input.isYieldEnabled && yieldAllocationPct === null) {
    throw new SavingsValidationError("yieldAllocationPct is required when enabling yield.");
  }

  const minimumBalanceFloor =
    input.minimumBalanceFloor !== undefined
      ? toSmallestUnit(input.minimumBalanceFloor)
      : bucket.minimumBalanceFloor;
  if (minimumBalanceFloor < 0n) {
    throw new SavingsValidationError("Minimum balance floor cannot be negative.");
  }

  return prisma.ledgerAccount.update({
    where: { id: ledgerAccountId },
    data: { isYieldEnabled: input.isYieldEnabled, yieldAllocationPct, minimumBalanceFloor },
  });
}

// ── SavingsRule value parsing (trigger-dependent semantics) ─────────────

/**
 * PERCENTAGE_OF_INCOME: "10" (=10%) -> basis points, 1–10000.
 * ROUND_UP: "10.00" (round up to the nearest $10) -> smallest USDC unit.
 * FIXED_RECURRING: "50.00" (USDC swept per occurrence) -> smallest USDC unit.
 */
function parseValueForTrigger(trigger: SavingsRuleTrigger, rawValue: string): bigint {
  if (trigger === "PERCENTAGE_OF_INCOME") {
    const trimmed = rawValue.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new SavingsValidationError(`"${rawValue}" isn't a valid percentage.`);
    }
    const [whole, fracRaw = ""] = trimmed.split(".");
    if (fracRaw.length > 2) {
      throw new SavingsValidationError("Percentages support at most 2 decimal places.");
    }
    const frac = fracRaw.padEnd(2, "0");
    const bps = BigInt(whole) * 100n + BigInt(frac || "0");
    if (bps <= 0n || bps > BASIS_POINTS_SCALE) {
      throw new SavingsValidationError("Percentage must be greater than 0 and at most 100.");
    }
    return bps;
  }

  // ROUND_UP (round-up unit) and FIXED_RECURRING (fixed amount) are both
  // plain USDC decimal amounts.
  let smallest: bigint;
  try {
    smallest = toSmallestUnit(rawValue);
  } catch {
    throw new SavingsValidationError(`"${rawValue}" isn't a valid USDC amount.`);
  }
  if (smallest <= 0n) {
    throw new SavingsValidationError("Value must be greater than zero.");
  }
  return smallest;
}

function describeRule(trigger: SavingsRuleTrigger, value: bigint, targetName: string): string {
  switch (trigger) {
    case "PERCENTAGE_OF_INCOME": {
      const pct = (Number(value) / 100).toFixed(2);
      return `Save ${pct}% of every incoming payment to ${targetName}`;
    }
    case "ROUND_UP":
      return `Round up every outgoing payment to the nearest ${toDecimalString(value)} USDC, save the difference to ${targetName}`;
    case "FIXED_RECURRING":
      return `Save ${toDecimalString(value)} USDC to ${targetName} on schedule`;
  }
}

// ── create ──────────────────────────────────────────────────────────────

export interface CreateSavingsRuleInput {
  orgId: string;
  sourceLedgerAccountId: string;
  targetLedgerAccountId: string;
  trigger: SavingsRuleTrigger;
  /** PERCENTAGE_OF_INCOME: "10" = 10%. ROUND_UP: "10.00" = round up to nearest $10. FIXED_RECURRING: "50.00" USDC. */
  value: string;
  scheduleCron?: string; // required iff trigger = FIXED_RECURRING
  name?: string;
}

export async function createSavingsRule(input: CreateSavingsRuleInput): Promise<SavingsRule> {
  if (input.sourceLedgerAccountId === input.targetLedgerAccountId) {
    throw new SavingsValidationError("Source and target buckets must be different.");
  }

  await assertBucketsBelongToOrg(input.orgId, [
    input.sourceLedgerAccountId,
    input.targetLedgerAccountId,
  ]);

  const [source, target] = await Promise.all([
    getBucket(input.orgId, input.sourceLedgerAccountId),
    getBucket(input.orgId, input.targetLedgerAccountId),
  ]);
  if (source.archived) throw new SavingsValidationError(`Bucket "${source.name}" is archived.`);
  if (target.archived) throw new SavingsValidationError(`Bucket "${target.name}" is archived.`);
  if (!target.isYieldEnabled) {
    throw new SavingsValidationError(
      `Target bucket "${target.name}" doesn't have yield enabled yet. Enable yield on it first ` +
        `(see setBucketYieldConfig / PATCH /api/savings/:ledgerAccountId).`
    );
  }

  if (input.trigger === "FIXED_RECURRING" && !input.scheduleCron?.trim()) {
    throw new SavingsValidationError("A schedule (cron expression) is required for FIXED_RECURRING rules.");
  }
  if (input.trigger !== "FIXED_RECURRING" && input.scheduleCron) {
    throw new SavingsValidationError("scheduleCron is only valid for FIXED_RECURRING rules.");
  }

  const value = parseValueForTrigger(input.trigger, input.value);

  return prisma.savingsRule.create({
    data: {
      orgId: input.orgId,
      sourceLedgerAccountId: input.sourceLedgerAccountId,
      targetLedgerAccountId: input.targetLedgerAccountId,
      trigger: input.trigger,
      value,
      scheduleCron: input.trigger === "FIXED_RECURRING" ? input.scheduleCron!.trim() : null,
      name: input.name?.trim() || describeRule(input.trigger, value, target.name),
      active: true,
    },
  });
}

// ── update ──────────────────────────────────────────────────────────────

export interface UpdateSavingsRuleInput {
  value?: string; // re-parsed against the rule's existing trigger — trigger itself is immutable
  active?: boolean;
  scheduleCron?: string;
  name?: string;
}

export async function updateSavingsRule(
  orgId: string,
  ruleId: string,
  input: UpdateSavingsRuleInput
): Promise<SavingsRule> {
  const rule = await prisma.savingsRule.findFirst({ where: { id: ruleId, orgId } });
  if (!rule) throw new SavingsRuleNotFoundError();

  const nextValue = input.value !== undefined ? parseValueForTrigger(rule.trigger, input.value) : rule.value;

  if (input.scheduleCron !== undefined && rule.trigger !== "FIXED_RECURRING") {
    throw new SavingsValidationError("scheduleCron is only valid for FIXED_RECURRING rules.");
  }

  return prisma.savingsRule.update({
    where: { id: ruleId },
    data: {
      value: nextValue,
      active: input.active ?? rule.active,
      scheduleCron: input.scheduleCron !== undefined ? input.scheduleCron.trim() : rule.scheduleCron,
      name: input.name !== undefined ? input.name.trim() || null : rule.name,
    },
  });
}

/** Convenience wrapper — the common case of turning a rule off without deleting its history. */
export async function deactivateSavingsRule(orgId: string, ruleId: string): Promise<SavingsRule> {
  return updateSavingsRule(orgId, ruleId, { active: false });
}

// ── delete ──────────────────────────────────────────────────────────────

/**
 * Hard-deletes a rule that has never fired. A rule with execution history
 * is kept for audit purposes — deactivate it instead (SavingsRuleExecution
 * rows FK to SavingsRule and are themselves append-only, mirroring
 * lib/allocationRules/service.ts#deleteAllocationRule's exact reasoning).
 */
export async function deleteSavingsRule(orgId: string, ruleId: string): Promise<void> {
  const rule = await prisma.savingsRule.findFirst({ where: { id: ruleId, orgId } });
  if (!rule) throw new SavingsRuleNotFoundError();

  const executionCount = await prisma.savingsRuleExecution.count({ where: { savingsRuleId: ruleId } });
  if (executionCount > 0) {
    throw new SavingsValidationError(
      `This rule has ${executionCount} recorded execution(s) and can't be deleted. Deactivate it instead ` +
        `to stop it from firing while keeping its history.`
    );
  }

  await prisma.savingsRule.delete({ where: { id: ruleId } });
}

// ── read ────────────────────────────────────────────────────────────────

export async function getSavingsRule(orgId: string, ruleId: string): Promise<SavingsRule> {
  const rule = await prisma.savingsRule.findFirst({ where: { id: ruleId, orgId } });
  if (!rule) throw new SavingsRuleNotFoundError();
  return rule;
}

export interface ListSavingsRulesOptions {
  sourceLedgerAccountId?: string;
  targetLedgerAccountId?: string;
  active?: boolean;
}

export async function listSavingsRules(
  orgId: string,
  options: ListSavingsRulesOptions = {}
): Promise<SavingsRule[]> {
  return prisma.savingsRule.findMany({
    where: {
      orgId,
      ...(options.sourceLedgerAccountId ? { sourceLedgerAccountId: options.sourceLedgerAccountId } : {}),
      ...(options.targetLedgerAccountId ? { targetLedgerAccountId: options.targetLedgerAccountId } : {}),
      ...(options.active !== undefined ? { active: options.active } : {}),
    },
    orderBy: [{ sourceLedgerAccountId: "asc" }, { createdAt: "asc" }],
  });
}