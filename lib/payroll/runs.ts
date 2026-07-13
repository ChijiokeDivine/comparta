// lib/payroll/runs.ts
//
// PayrollRun/PayrollRunItem lifecycle: creation (auto from a schedule, or
// manual), the pre-approval review summary, and the approval gate itself.
// This module NEVER moves money — it only ever gets a run to PROCESSING
// and enqueues the execution job. See jobs/executePayroll.ts for the part
// that actually calls sendPayment().
//
// State machine:
//   DRAFT --submitRunForApproval--> PENDING_APPROVAL --approveRun--> PROCESSING --(execution job)--> COMPLETED
//                                        |
//                                        `--returnRunToDraft--> DRAFT
//
// PROCESSING -> COMPLETED/FAILED is driven by jobs/executePayroll.ts, not
// this module. A DRAFT run can still be freely edited (items
// added/removed/amount-changed); PENDING_APPROVAL cannot — return it to
// DRAFT first.

import { prisma } from "@/lib/db/prisma";
import type { Prisma, Payee, PayrollRun, PayrollRunItem, PayrollSchedule } from "@/app/generated/prisma/client";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { getBalance } from "@/lib/ledger/engine";
import { getBucket } from "@/lib/buckets/service";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { getQueue, QUEUE_NAMES } from "@/jobs/queue";

type Tx = Prisma.TransactionClient;

export class PayrollRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollRunValidationError";
  }
}

export class PayrollRunNotFoundError extends Error {
  constructor() {
    super("Payroll run not found");
    this.name = "PayrollRunNotFoundError";
  }
}

export class PayrollRunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollRunStateError";
  }
}

/** Thrown by approveRun when the source bucket can't cover the run's total. Carries the exact shortfall so the caller never has to re-derive it. */
export class InsufficientPayrollBalanceError extends Error {
  constructor(
    public readonly required: bigint,
    public readonly available: bigint
  ) {
    const shortfall = required - available;
    super(
      `This run needs ${toDecimalString(required)} USDC but the source bucket only has ${toDecimalString(available)} ` +
        `USDC available — short by ${toDecimalString(shortfall)} USDC. Add funds or reduce the run before approving.`
    );
    this.name = "InsufficientPayrollBalanceError";
  }
}

/** Thrown by approveRun when any item has an unresolved-identifier flag. */
export class UnresolvedPayeeIdentifiersError extends Error {
  constructor(public readonly payeeNames: string[]) {
    super(
      `${payeeNames.length} payee(s) have an identifier that can't currently be resolved and must be fixed or ` +
        `removed from this run before it can be approved: ${payeeNames.join(", ")}.`
    );
    this.name = "UnresolvedPayeeIdentifiersError";
  }
}

// ── identifier resolvability check (the "flag at creation time" edge case) ──

interface IdentifierCheckResult {
  identifierIssue: boolean;
  failureReason: string | null;
}

async function checkPayeeIdentifier(payee: Payee): Promise<IdentifierCheckResult> {
  try {
    await resolve(payee.identifier);
    return { identifierIssue: false, failureReason: null };
  } catch (err) {
    if (err instanceof ResolverError) {
      return { identifierIssue: true, failureReason: `Recipient identifier could not be resolved: ${err.message}` };
    }
    throw err;
  }
}

async function recomputeTotal(tx: Tx, payrollRunId: string): Promise<void> {
  const items = await tx.payrollRunItem.findMany({ where: { payrollRunId }, select: { amount: true } });
  const total = items.reduce((sum, i) => sum + i.amount, 0n);
  await tx.payrollRun.update({ where: { id: payrollRunId }, data: { totalAmount: total } });
}

// ── auto-generation from a schedule (called by lib/payroll/scheduler.ts) ──

export interface GenerateDraftRunResult {
  run: PayrollRun;
  skippedPayeeNames: string[]; // active payees with no defaultAmount — excluded, must be added manually if wanted
}

/**
 * Builds a DRAFT PayrollRun from every active Payee with a non-null
 * defaultAmount > 0. Payees without a defaultAmount (typically HOURLY
 * workers whose amount varies per period) are skipped, not guessed at —
 * they show up in skippedPayeeNames so the caller (the scheduler, or a
 * "regenerate" UI action) can surface them for manual addition before
 * the run is submitted for approval. `scheduledFor` must be the
 * schedule's nextRunDate at the moment of generation — it's the
 * duplicate-run guard (see PayrollRun's unique constraint).
 */
export async function generateDraftRunFromSchedule(
  schedule: PayrollSchedule,
  scheduledFor: Date
): Promise<GenerateDraftRunResult> {
  const payees = await prisma.payee.findMany({ where: { orgId: schedule.orgId, active: true } });

  const eligible = payees.filter((p) => p.defaultAmount !== null && p.defaultAmount > 0n);
  const skippedPayeeNames = payees.filter((p) => !(p.defaultAmount !== null && p.defaultAmount > 0n)).map((p) => p.name);

  const identifierChecks = await Promise.all(eligible.map((p) => checkPayeeIdentifier(p)));

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollRun.create({
      data: {
        orgId: schedule.orgId,
        payrollScheduleId: schedule.id,
        sourceLedgerAccountId: schedule.sourceLedgerAccountId,
        scheduledFor,
        status: "DRAFT",
        initiatedBy: null, // system-generated — see PayrollRun.initiatedBy doc comment in schema.prisma
      },
    });

    if (eligible.length > 0) {
      await tx.payrollRunItem.createMany({
        data: eligible.map((payee, i) => ({
          payrollRunId: created.id,
          payeeId: payee.id,
          amount: payee.defaultAmount!,
          identifierIssue: identifierChecks[i]!.identifierIssue,
          failureReason: identifierChecks[i]!.failureReason,
        })),
      });
      await recomputeTotal(tx, created.id);
    }

    return created;
  });

  return { run, skippedPayeeNames };
}

// ── manual / one-off run creation ──────────────────────────────────────

export interface CreateManualRunItemInput {
  payeeId: string;
  /** Decimal string. Falls back to the payee's defaultAmount if omitted — throws if neither is available. */
  amount?: string;
}

export interface CreateManualRunInput {
  orgId: string;
  sourceLedgerAccountId: string;
  initiatedBy: string;
  items: CreateManualRunItemInput[];
}

export async function createManualRun(input: CreateManualRunInput): Promise<PayrollRun> {
  if (input.items.length === 0) {
    throw new PayrollRunValidationError("A payroll run needs at least one payee.");
  }

  const bucket = await getBucket(input.orgId, input.sourceLedgerAccountId);
  if (bucket.archived) {
    throw new PayrollRunValidationError(`Bucket "${bucket.name}" is archived and can't fund a payroll run.`);
  }

  const payeeIds = input.items.map((i) => i.payeeId);
  const uniquePayeeIds = new Set(payeeIds);
  if (uniquePayeeIds.size !== payeeIds.length) {
    throw new PayrollRunValidationError("The same payee was listed more than once in this run.");
  }

  const payees = await prisma.payee.findMany({ where: { id: { in: payeeIds }, orgId: input.orgId } });
  if (payees.length !== payeeIds.length) {
    throw new PayrollRunValidationError("One or more payees were not found on this organization.");
  }
  const payeeById = new Map(payees.map((p) => [p.id, p]));

  const resolvedItems = input.items.map((item) => {
    const payee = payeeById.get(item.payeeId)!;
    const rawAmount = item.amount ?? (payee.defaultAmount !== null ? toDecimalString(payee.defaultAmount) : undefined);
    if (rawAmount === undefined) {
      throw new PayrollRunValidationError(
        `"${payee.name}" has no default amount — an explicit amount is required for this payee.`
      );
    }
    let amount: bigint;
    try {
      amount = toSmallestUnit(rawAmount);
    } catch {
      throw new PayrollRunValidationError(`"${rawAmount}" isn't a valid USDC amount for payee "${payee.name}".`);
    }
    if (amount <= 0n) {
      throw new PayrollRunValidationError(`Amount for "${payee.name}" must be greater than zero.`);
    }
    return { payee, amount };
  });

  const identifierChecks = await Promise.all(resolvedItems.map((r) => checkPayeeIdentifier(r.payee)));

  return prisma.$transaction(async (tx) => {
    const run = await tx.payrollRun.create({
      data: {
        orgId: input.orgId,
        sourceLedgerAccountId: input.sourceLedgerAccountId,
        status: "DRAFT",
        initiatedBy: input.initiatedBy,
      },
    });

    await tx.payrollRunItem.createMany({
      data: resolvedItems.map((r, i) => ({
        payrollRunId: run.id,
        payeeId: r.payee.id,
        amount: r.amount,
        identifierIssue: identifierChecks[i]!.identifierIssue,
        failureReason: identifierChecks[i]!.failureReason,
      })),
    });
    await recomputeTotal(tx, run.id);

    return run;
  });
}

// ── DRAFT editing ───────────────────────────────────────────────────────

async function assertDraft(run: PayrollRun): Promise<void> {
  if (run.status !== "DRAFT") {
    throw new PayrollRunStateError(
      `This run is ${run.status.replace("_", " ").toLowerCase()} and can no longer be edited. ` +
        (run.status === "PENDING_APPROVAL" ? "Return it to draft first." : "")
    );
  }
}

export async function addRunItem(
  orgId: string,
  runId: string,
  payeeId: string,
  amount?: string
): Promise<PayrollRunItem> {
  const run = await getPayrollRun(orgId, runId);
  await assertDraft(run);

  const payee = await prisma.payee.findFirst({ where: { id: payeeId, orgId } });
  if (!payee) throw new PayrollRunValidationError("Payee not found.");

  const existing = await prisma.payrollRunItem.findFirst({ where: { payrollRunId: runId, payeeId } });
  if (existing) throw new PayrollRunValidationError(`"${payee.name}" is already on this run.`);

  const rawAmount = amount ?? (payee.defaultAmount !== null ? toDecimalString(payee.defaultAmount) : undefined);
  if (rawAmount === undefined) {
    throw new PayrollRunValidationError(`"${payee.name}" has no default amount — an explicit amount is required.`);
  }
  let parsedAmount: bigint;
  try {
    parsedAmount = toSmallestUnit(rawAmount);
  } catch {
    throw new PayrollRunValidationError(`"${rawAmount}" isn't a valid USDC amount.`);
  }
  if (parsedAmount <= 0n) throw new PayrollRunValidationError("Amount must be greater than zero.");

  const { identifierIssue, failureReason } = await checkPayeeIdentifier(payee);

  return prisma.$transaction(async (tx) => {
    const item = await tx.payrollRunItem.create({
      data: { payrollRunId: runId, payeeId, amount: parsedAmount, identifierIssue, failureReason },
    });
    await recomputeTotal(tx, runId);
    return item;
  });
}

export async function removeRunItem(orgId: string, runId: string, itemId: string): Promise<void> {
  const run = await getPayrollRun(orgId, runId);
  await assertDraft(run);

  const item = await prisma.payrollRunItem.findFirst({ where: { id: itemId, payrollRunId: runId } });
  if (!item) throw new PayrollRunValidationError("Line item not found on this run.");

  await prisma.$transaction(async (tx) => {
    await tx.payrollRunItem.delete({ where: { id: itemId } });
    await recomputeTotal(tx, runId);
  });
}

export async function updateRunItemAmount(
  orgId: string,
  runId: string,
  itemId: string,
  amount: string
): Promise<PayrollRunItem> {
  const run = await getPayrollRun(orgId, runId);
  await assertDraft(run);

  const item = await prisma.payrollRunItem.findFirst({ where: { id: itemId, payrollRunId: runId } });
  if (!item) throw new PayrollRunValidationError("Line item not found on this run.");

  let parsedAmount: bigint;
  try {
    parsedAmount = toSmallestUnit(amount);
  } catch {
    throw new PayrollRunValidationError(`"${amount}" isn't a valid USDC amount.`);
  }
  if (parsedAmount <= 0n) throw new PayrollRunValidationError("Amount must be greater than zero.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payrollRunItem.update({ where: { id: itemId }, data: { amount: parsedAmount } });
    await recomputeTotal(tx, runId);
    return updated;
  });
}

/** Deletes a DRAFT run entirely (e.g. an auto-generated run the org doesn't want this period). Non-DRAFT runs must never be deleted — they're the audit trail. */
export async function deleteDraftRun(orgId: string, runId: string): Promise<void> {
  const run = await getPayrollRun(orgId, runId);
  await assertDraft(run);
  await prisma.payrollRun.delete({ where: { id: runId } }); // items cascade
}

// ── state transitions ──────────────────────────────────────────────────

export async function submitRunForApproval(orgId: string, runId: string): Promise<PayrollRun> {
  const run = await getPayrollRun(orgId, runId);
  await assertDraft(run);

  const itemCount = await prisma.payrollRunItem.count({ where: { payrollRunId: runId } });
  if (itemCount === 0) {
    throw new PayrollRunValidationError("Add at least one payee to this run before submitting it for approval.");
  }

  return prisma.payrollRun.update({ where: { id: runId }, data: { status: "PENDING_APPROVAL" } });
}

/** Sends a PENDING_APPROVAL run back to DRAFT so it can be edited (e.g. to fix an unresolved identifier or top up the source bucket). */
export async function returnRunToDraft(orgId: string, runId: string): Promise<PayrollRun> {
  const run = await getPayrollRun(orgId, runId);
  if (run.status !== "PENDING_APPROVAL") {
    throw new PayrollRunStateError(`Only a run pending approval can be returned to draft (this run is ${run.status}).`);
  }
  return prisma.payrollRun.update({ where: { id: runId }, data: { status: "DRAFT" } });
}

/**
 * The approval gate. Caller (the API route) is responsible for
 * confirming the approver is an OWNER/ADMIN via
 * lib/auth/canManageBucket.ts#assertCanManageBucket — this function only
 * handles the payroll-specific invariants:
 *
 *   1. Run must be PENDING_APPROVAL.
 *   2. No item may have an unresolved identifier (identifierIssue) —
 *      the "flag at creation, block at approval" edge case.
 *   3. The source bucket's CURRENT balance must cover the run's total —
 *      re-checked here (not just at review-time) since balance can move
 *      between review and approval. Blocks approval outright rather than
 *      allowing a partial/silent execution.
 *
 * On success, flips the run to PROCESSING and enqueues the execution job
 * (jobs/executePayroll.ts) — this function itself never calls
 * sendPayment().
 */
export async function approveRun(orgId: string, runId: string, approverUserId: string): Promise<PayrollRun> {
  const run = await getPayrollRunWithItems(orgId, runId);

  if (run.status !== "PENDING_APPROVAL") {
    throw new PayrollRunStateError(
      `Only a run pending approval can be approved (this run is ${run.status}). Submit it for approval first.`
    );
  }

  const unresolved = run.items.filter((i) => i.identifierIssue);
  if (unresolved.length > 0) {
    const payeeIds = unresolved.map((i) => i.payeeId);
    const payees = await prisma.payee.findMany({ where: { id: { in: payeeIds } }, select: { name: true } });
    throw new UnresolvedPayeeIdentifiersError(payees.map((p) => p.name));
  }

  const available = await getBalance(run.sourceLedgerAccountId);
  if (available < run.totalAmount) {
    throw new InsufficientPayrollBalanceError(run.totalAmount, available);
  }

  const approved = await prisma.payrollRun.update({
    where: { id: runId },
    data: { status: "PROCESSING", approvedBy: approverUserId, approvedAt: new Date() },
  });

  await enqueueExecution(runId);

  return approved;
}

async function enqueueExecution(payrollRunId: string): Promise<void> {
  try {
    const queue = getQueue(QUEUE_NAMES.PAYROLL_RUN);
    await queue.add(
      "execute",
      { payrollRunId },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: false }
    );
  } catch (err) {
    // The run is already PROCESSING at this point — a failed enqueue
    // must be loud, not silent, since otherwise the run sits in
    // PROCESSING forever with nothing driving it forward. An operator
    // (or a periodic sweep, not built in v1) needs to retry the enqueue
    // or call executePayrollRun(payrollRunId) directly.
    console.error(
      `[payroll] CRITICAL: run ${payrollRunId} was approved and marked PROCESSING but enqueueing execution failed. ` +
        `Call executePayrollRun("${payrollRunId}") directly to recover.`,
      err
    );
  }
}

// ── read model ──────────────────────────────────────────────────────────

export async function getPayrollRun(orgId: string, runId: string): Promise<PayrollRun> {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, orgId } });
  if (!run) throw new PayrollRunNotFoundError();
  return run;
}

export async function getPayrollRunWithItems(
  orgId: string,
  runId: string
): Promise<PayrollRun & { items: (PayrollRunItem & { payee: Payee })[] }> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, orgId },
    include: { items: { include: { payee: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!run) throw new PayrollRunNotFoundError();
  return run;
}

export async function listPayrollRuns(
  orgId: string,
  options: { status?: PayrollRun["status"]; payrollScheduleId?: string } = {}
): Promise<PayrollRun[]> {
  return prisma.payrollRun.findMany({
    where: {
      orgId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.payrollScheduleId ? { payrollScheduleId: options.payrollScheduleId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface PayrollRunReview {
  run: PayrollRun & { items: (PayrollRunItem & { payee: Payee })[] };
  sourceBucketName: string;
  /** Decimal string — the source bucket's current balance. */
  sourceBucketBalance: string;
  /** Decimal string — sum of item amounts. */
  totalAmount: string;
  /** True if sourceBucketBalance < totalAmount. */
  insufficientFunds: boolean;
  /** Decimal string, only set when insufficientFunds is true — exactly how much more is needed. */
  shortfall: string | null;
  /** Payees on this run whose identifier currently fails to resolve — must be fixed/removed before approval. */
  unresolvedIdentifiers: { itemId: string; payeeId: string; payeeName: string; reason: string }[];
}

/** The line-by-line breakdown for the run review screen: total cost, per-payee amount, and a live balance check. */
export async function getPayrollRunReview(orgId: string, runId: string): Promise<PayrollRunReview> {
  const run = await getPayrollRunWithItems(orgId, runId);
  const bucket = await getBucket(orgId, run.sourceLedgerAccountId);
  const balance = await getBalance(run.sourceLedgerAccountId);

  const insufficientFunds = balance < run.totalAmount;

  return {
    run,
    sourceBucketName: bucket.name,
    sourceBucketBalance: toDecimalString(balance),
    totalAmount: toDecimalString(run.totalAmount),
    insufficientFunds,
    shortfall: insufficientFunds ? toDecimalString(run.totalAmount - balance) : null,
    unresolvedIdentifiers: run.items
      .filter((i) => i.identifierIssue)
      .map((i) => ({
        itemId: i.id,
        payeeId: i.payeeId,
        payeeName: i.payee.name,
        reason: i.failureReason ?? "Identifier could not be resolved.",
      })),
  };
}