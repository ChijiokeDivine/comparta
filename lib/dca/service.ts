// lib/dca/service.ts
//
// CRUD for RecurringTransfer (DCA). Execution logic — actually moving
// money on the scheduled cadence — lives in lib/dca/execution.ts and
// jobs/processRecurringTransfers.ts; this module only ever
// creates/reads/updates the schedule rows themselves.

import { prisma } from "@/lib/db/prisma";
import { getBucket } from "@/lib/buckets/service";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { toSmallestUnit } from "@/lib/circle/amount";
import type {
  RecurringTransfer,
  RecurringTransferFrequency,
  RecurringTransferStatus,
} from "@/app/generated/prisma/client";

export class DcaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DcaValidationError";
  }
}

export class RecurringTransferNotFoundError extends Error {
  constructor() {
    super("Recurring transfer not found");
    this.name = "RecurringTransferNotFoundError";
  }
}

// ── create ──────────────────────────────────────────────────────────────

export interface CreateRecurringTransferInput {
  orgId: string;
  createdBy: string;
  sourceLedgerAccountId: string;
  /**
   * EXACTLY ONE of these two must be set:
   *   - destinationIdentifier: a Comparta username or raw Arc address
   *     (same Address Book flow as a manual send). Validated here by
   *     resolving it once (fail fast on a typo/unclaimed username at
   *     setup time) — but the resolution result is discarded, NEVER
   *     cached. Every execution re-resolves fresh (see
   *     lib/dca/execution.ts) — that's the whole point.
   *   - destinationLedgerAccountId: another bucket THIS SAME ORG owns.
   */
  destinationIdentifier?: string;
  destinationLedgerAccountId?: string;
  /** Decimal string, e.g. "500.00". Fixed every cycle. */
  amount: string;
  frequency: RecurringTransferFrequency;
  /** ISO date(-time) string, UTC — the first scheduled execution. */
  startDate: string;
  /** ISO date(-time) string, UTC, or omit/null for "run forever". */
  endDate?: string | null;
  name?: string;
}

export async function createRecurringTransfer(
  input: CreateRecurringTransferInput
): Promise<RecurringTransfer> {
  const hasIdentifier = !!input.destinationIdentifier?.trim();
  const hasBucket = !!input.destinationLedgerAccountId;
  if (hasIdentifier === hasBucket) {
    throw new DcaValidationError(
      "Provide exactly one destination: either destinationIdentifier (username/address) or " +
        "destinationLedgerAccountId (another bucket) — not both, not neither."
    );
  }

  const sourceBucket = await getBucket(input.orgId, input.sourceLedgerAccountId);
  if (sourceBucket.archived) {
    throw new DcaValidationError(
      `Bucket "${sourceBucket.name}" is archived and can't fund a recurring transfer.`
    );
  }

  let destinationLedgerAccountId: string | undefined;
  let destinationIdentifier: string | undefined;

  if (hasBucket) {
    if (input.destinationLedgerAccountId === input.sourceLedgerAccountId) {
      throw new DcaValidationError("Source and destination buckets must be different.");
    }
    const destBucket = await getBucket(input.orgId, input.destinationLedgerAccountId!);
    if (destBucket.archived) {
      throw new DcaValidationError(
        `Bucket "${destBucket.name}" is archived and can't receive a recurring transfer.`
      );
    }
    destinationLedgerAccountId = destBucket.id;
  } else {
    // Fail fast on a malformed/unresolvable identifier at setup time —
    // purely a UX nicety. lib/dca/execution.ts resolves fresh at every
    // execution regardless of what happens here.
    try {
      await resolve(input.destinationIdentifier!);
    } catch (err) {
      if (err instanceof ResolverError) throw new DcaValidationError(err.message);
      throw err;
    }
    destinationIdentifier = input.destinationIdentifier!.trim();
  }

  let amount: bigint;
  try {
    amount = toSmallestUnit(input.amount);
  } catch {
    throw new DcaValidationError(`"${input.amount}" isn't a valid USDC amount.`);
  }
  if (amount <= 0n) throw new DcaValidationError("Amount must be greater than zero.");

  const startDate = new Date(input.startDate);
  if (Number.isNaN(startDate.getTime())) {
    throw new DcaValidationError(`"${input.startDate}" isn't a valid date.`);
  }

  let endDate: Date | null = null;
  if (input.endDate) {
    endDate = new Date(input.endDate);
    if (Number.isNaN(endDate.getTime())) {
      throw new DcaValidationError(`"${input.endDate}" isn't a valid date.`);
    }
    if (endDate.getTime() <= startDate.getTime()) {
      throw new DcaValidationError("End date must be after the start date.");
    }
  }

  return prisma.recurringTransfer.create({
    data: {
      orgId: input.orgId,
      createdBy: input.createdBy,
      sourceLedgerAccountId: input.sourceLedgerAccountId,
      destinationIdentifier: destinationIdentifier ?? null,
      destinationLedgerAccountId: destinationLedgerAccountId ?? null,
      amount,
      frequency: input.frequency,
      nextExecutionDate: startDate,
      endDate,
      name: input.name?.trim() || null,
      status: "ACTIVE",
    },
  });
}

// ── read ────────────────────────────────────────────────────────────────

export async function getRecurringTransfer(
  orgId: string,
  id: string
): Promise<RecurringTransfer> {
  const transfer = await prisma.recurringTransfer.findFirst({ where: { id, orgId } });
  if (!transfer) throw new RecurringTransferNotFoundError();
  return transfer;
}

export interface ListRecurringTransfersOptions {
  status?: RecurringTransferStatus;
  sourceLedgerAccountId?: string;
}

export async function listRecurringTransfers(
  orgId: string,
  options: ListRecurringTransfersOptions = {}
): Promise<RecurringTransfer[]> {
  return prisma.recurringTransfer.findMany({
    where: {
      orgId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.sourceLedgerAccountId
        ? { sourceLedgerAccountId: options.sourceLedgerAccountId }
        : {}),
    },
    orderBy: [{ status: "asc" }, { nextExecutionDate: "asc" }],
  });
}

// ── update (editable fields only — source/destination are immutable;
// cancel and recreate if either needs to change) ────────────────────────

export interface UpdateRecurringTransferInput {
  amount?: string;
  frequency?: RecurringTransferFrequency;
  endDate?: string | null;
  name?: string | null;
}

export async function updateRecurringTransfer(
  orgId: string,
  id: string,
  input: UpdateRecurringTransferInput
): Promise<RecurringTransfer> {
  const transfer = await getRecurringTransfer(orgId, id);
  if (transfer.status !== "ACTIVE" && transfer.status !== "PAUSED") {
    throw new DcaValidationError(
      `Can't edit a recurring transfer that's ${transfer.status}. Create a new one instead.`
    );
  }

  let amount: bigint | undefined;
  if (input.amount !== undefined) {
    try {
      amount = toSmallestUnit(input.amount);
    } catch {
      throw new DcaValidationError(`"${input.amount}" isn't a valid USDC amount.`);
    }
    if (amount <= 0n) throw new DcaValidationError("Amount must be greater than zero.");
  }

  let endDate: Date | null | undefined;
  if (input.endDate !== undefined) {
    if (input.endDate === null) {
      endDate = null;
    } else {
      endDate = new Date(input.endDate);
      if (Number.isNaN(endDate.getTime())) {
        throw new DcaValidationError(`"${input.endDate}" isn't a valid date.`);
      }
      if (endDate.getTime() <= transfer.nextExecutionDate.getTime()) {
        throw new DcaValidationError("End date must be after the next scheduled execution.");
      }
    }
  }

  return prisma.recurringTransfer.update({
    where: { id },
    data: {
      amount: amount ?? undefined,
      frequency: input.frequency ?? undefined,
      endDate: endDate !== undefined ? endDate : undefined,
      name: input.name !== undefined ? input.name?.trim() || null : undefined,
    },
  });
}

// ── status transitions ──────────────────────────────────────────────────

export async function pauseRecurringTransfer(
  orgId: string,
  id: string
): Promise<RecurringTransfer> {
  const transfer = await getRecurringTransfer(orgId, id);
  if (transfer.status !== "ACTIVE") {
    throw new DcaValidationError(
      `Only an ACTIVE recurring transfer can be paused (this one is ${transfer.status}).`
    );
  }
  return prisma.recurringTransfer.update({ where: { id }, data: { status: "PAUSED" } });
}

/**
 * Resumes a PAUSED transfer. Deliberately does NOT adjust
 * nextExecutionDate: if it fell in the past while paused, resuming makes
 * it immediately due on the very next sweep — a simple, predictable
 * "catch up once, then continue on cadence" behavior rather than trying
 * to guess how many missed cycles to silently skip or replay.
 */
export async function resumeRecurringTransfer(
  orgId: string,
  id: string
): Promise<RecurringTransfer> {
  const transfer = await getRecurringTransfer(orgId, id);
  if (transfer.status !== "PAUSED") {
    throw new DcaValidationError(
      `Only a PAUSED recurring transfer can be resumed (this one is ${transfer.status}).`
    );
  }
  return prisma.recurringTransfer.update({ where: { id }, data: { status: "ACTIVE" } });
}

export async function cancelRecurringTransfer(
  orgId: string,
  id: string
): Promise<RecurringTransfer> {
  const transfer = await getRecurringTransfer(orgId, id);
  if (transfer.status === "CANCELLED" || transfer.status === "COMPLETED") {
    throw new DcaValidationError(`This recurring transfer is already ${transfer.status}.`);
  }
  return prisma.recurringTransfer.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
}

// ── execution history ───────────────────────────────────────────────────

export async function listRecurringTransferExecutions(orgId: string, id: string) {
  await getRecurringTransfer(orgId, id); // ownership check
  return prisma.recurringTransferExecution.findMany({
    where: { recurringTransferId: id },
    orderBy: { createdAt: "desc" },
  });
}