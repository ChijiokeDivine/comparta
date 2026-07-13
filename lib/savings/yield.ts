// lib/savings/yield.ts
//
// Deploys a savings bucket's liquid USDC into USYC (for yield) and
// redeems USYC back to USDC on demand. This is the ONLY module allowed
// to create/mutate YieldPosition and YieldRedemptionRequest rows —
// mirrors how lib/ledger/engine.ts is the only module allowed to touch
// LedgerEntry.
//
// Balance model (read this before touching this file):
//   - A bucket's ledger balance (lib/ledger/engine.ts#getBalance)
//     represents ONLY liquid, immediately-spendable USDC — the same
//     invariant every other bucket in this codebase holds. Nothing about
//     this phase changes that.
//   - Deploying into USYC therefore DEBITs the bucket's ledger balance
//     (referenceType YIELD_DEPLOYMENT) the moment funds leave the
//     spendable pool, and creates a YieldPosition tracking what was
//     deployed and at what NAV.
//   - Redeeming CREDITs the ledger balance back (referenceType
//     YIELD_REDEMPTION) once Circle confirms the USDC settlement — NOT
//     at request time. Even though USYC redemption is billed as
//     "near-instant", this module always models it as an async
//     PENDING -> PROCESSING -> COMPLETED/FAILED state machine (see
//     YieldRedemptionRequest and jobs/confirmYieldRedemption.ts) so a
//     slow settlement or a transient Circle failure is never presented
//     to the user as a silently-lost request.
//
// Deploys are only ever triggered as a side effect of a savings sweep
// (see lib/savings/sweep.ts) — there's no "manually deploy $X" user
// action, mirroring how the product spec frames yield as something a
// bucket does automatically, not a separate transfer the user initiates.
// Redemption IS a direct user action (requestRedemption), since "give me
// my liquidity back" is exactly the button the UI needs.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { getBucket } from "@/lib/buckets/service";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { createUsycConversion, CircleUsycApiError } from "@/lib/circle/usyc";
import { getCachedUsycNav } from "./yieldRate";
import { getQueue, QUEUE_NAMES } from "@/jobs/queue";
import type {
  LedgerReferenceType,
  YieldPosition,
  YieldRedemptionRequest,
} from "@/app/generated/prisma/client";

export class YieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YieldError";
  }
}

export class YieldNotEnabledError extends YieldError {
  constructor() {
    super("This bucket does not have yield enabled.");
    this.name = "YieldNotEnabledError";
  }
}

export class InsufficientYieldPositionError extends YieldError {
  constructor(available: bigint, requested: bigint) {
    super(
      `Redemption requested ${toDecimalString(requested)} USYC-equivalent but only ` +
        `${toDecimalString(available)} is available (unlocked, not already tied up in another ` +
        `pending redemption) to redeem.`
    );
    this.name = "InsufficientYieldPositionError";
  }
}

// USYC's smallest-unit convention — this codebase assumes 6 decimals,
// matching USDC (see lib/circle/amount.ts). If Circle's USYC integration
// uses a different decimal count, this is the one place to change it.
const USDC_SCALE = 1_000_000n;

/** usdcAmount / nav, both in smallest-unit bigint math (nav is a decimal string like "1.05123456"). */
export function usdcToUsyc(usdcAmount: bigint, navDecimalString: string): bigint {
  const navSmallest = toSmallestUnit(navDecimalString);
  return (usdcAmount * USDC_SCALE) / navSmallest;
}

/** usycAmount * nav, both in smallest-unit bigint math. */
export function usycToUsdc(usycAmount: bigint, navDecimalString: string): bigint {
  const navSmallest = toSmallestUnit(navDecimalString);
  return (usycAmount * navSmallest) / USDC_SCALE;
}

// ── deploy: liquid USDC -> USYC ─────────────────────────────────────────

export interface DeployToYieldParams {
  orgId: string;
  ledgerAccountId: string;
  /** Smallest USDC unit to convert. Caller (lib/savings/sweep.ts) computes this against yieldAllocationPct — this function trusts the amount and only re-validates it against the bucket's current liquid balance via recordEntry's own row lock. */
  amount: bigint;
  referenceType: LedgerReferenceType;
  referenceId: string;
}

export interface DeployToYieldResult {
  yieldPosition: YieldPosition;
  usycAmount: bigint;
}

/**
 * Debits `amount` liquid USDC from the bucket and converts it into USYC,
 * creating a new YieldPosition. Called by lib/savings/sweep.ts right
 * after a sweep lands funds in a yield-enabled bucket.
 */
export async function deployToYield(params: DeployToYieldParams): Promise<DeployToYieldResult> {
  const bucket = await getBucket(params.orgId, params.ledgerAccountId);
  if (!bucket.isYieldEnabled) throw new YieldNotEnabledError();
  if (params.amount <= 0n) throw new YieldError("Deploy amount must be positive.");

  const nav = await getCachedUsycNav();
  const usycAmount = usdcToUsyc(params.amount, nav.navPerShare);
  if (usycAmount <= 0n) {
    throw new YieldError("Deploy amount is too small to convert to any USYC at the current NAV.");
  }

  const idempotencyKey = `yield-deploy-${params.referenceId}`;

  // Debit the ledger FIRST, in its own transaction — recordEntry's row
  // lock is what actually protects against a concurrent sweep
  // over-deploying past the bucket's real liquid balance. If the Circle
  // call below fails, we reverse this debit with an offsetting credit
  // rather than trying to "undo" inside one shared transaction —
  // mirrors lib/transfers/send.ts's posture that a Circle call never
  // lives inside a DB transaction.
  const debit = await recordEntry({
    ledgerAccountId: params.ledgerAccountId,
    amount: params.amount,
    direction: "DEBIT",
    referenceType: "YIELD_DEPLOYMENT",
    referenceId: params.referenceId,
  });

  try {
    const wallet = await prisma.wallet.findUnique({ where: { id: bucket.walletId } });
    if (!wallet) throw new YieldError("Bucket's wallet not found.");

    await createUsycConversion({
      walletId: wallet.circleWalletId,
      direction: "USDC_TO_USYC",
      amount: toDecimalString(params.amount),
      idempotencyKey,
    });

    const position = await prisma.yieldPosition.create({
      data: {
        ledgerAccountId: params.ledgerAccountId,
        usycAmount,
        usdcEquivalentAtDeploy: params.amount,
        navAtDeploy: nav.navPerShare,
        status: "ACTIVE",
      },
    });

    return { yieldPosition: position, usycAmount };
  } catch (err) {
    console.error(
      `[yield] deploy failed for bucket ${params.ledgerAccountId}, reversing debit ${debit.id}`,
      err
    );
    // The conversion never happened (or we can't confirm it did) — the
    // funds must go back to being spendable, never silently vanish.
    await recordEntry({
      ledgerAccountId: params.ledgerAccountId,
      amount: params.amount,
      direction: "CREDIT",
      referenceType: "ADJUSTMENT",
      referenceId: `${params.referenceId}-deploy-reversal`,
    });

    if (err instanceof CircleUsycApiError) {
      throw new YieldError(
        "Could not deploy funds into USYC right now. The funds remain liquid in this bucket."
      );
    }
    throw err;
  }
}

// ── redeem: USYC -> liquid USDC ─────────────────────────────────────────

export interface RequestRedemptionParams {
  orgId: string;
  ledgerAccountId: string;
  /** Decimal string, USYC units, e.g. "500.00". Omit (or pass "all") to redeem every available ACTIVE position in full. */
  usycAmount?: string;
}

export interface RequestRedemptionResult {
  requests: YieldRedemptionRequest[];
  totalUsycAmountRequested: bigint;
}

/**
 * Kicks off redemption of up to `usycAmount` USYC (across the bucket's
 * ACTIVE positions, oldest first) back to liquid USDC. ALWAYS creates
 * PENDING YieldRedemptionRequest row(s) and submits to Circle
 * asynchronously — never assumes the conversion is instantly done, even
 * though USYC's real-world settlement is typically fast. Supports
 * partial redemption of a single position, and redemption spanning
 * multiple positions, transparently.
 */
export async function requestRedemption(
  params: RequestRedemptionParams
): Promise<RequestRedemptionResult> {
  const bucket = await getBucket(params.orgId, params.ledgerAccountId);
  if (!bucket.isYieldEnabled) throw new YieldNotEnabledError();

  const activePositions = await prisma.yieldPosition.findMany({
    where: { ledgerAccountId: params.ledgerAccountId, status: "ACTIVE" },
    orderBy: { deployedAt: "asc" },
  });

  // "Available to redeem" excludes any usycAmount already tied up in a
  // not-yet-terminal redemption request against the SAME position — two
  // concurrent redeem clicks must never both succeed against the same
  // USYC (the edge case the spec calls out explicitly).
  const pendingByPosition = await getPendingRedemptionAmountsByPosition(
    activePositions.map((p) => p.id)
  );

  const availablePositions = activePositions
    .map((p) => ({ position: p, available: p.usycAmount - (pendingByPosition.get(p.id) ?? 0n) }))
    .filter((p) => p.available > 0n);

  const totalAvailable = availablePositions.reduce((sum, p) => sum + p.available, 0n);

  const requestedUsyc =
    params.usycAmount === undefined || params.usycAmount.trim().toLowerCase() === "all"
      ? totalAvailable
      : toSmallestUnit(params.usycAmount);

  if (requestedUsyc <= 0n) {
    throw new YieldError("Redemption amount must be greater than zero.");
  }
  if (requestedUsyc > totalAvailable) {
    throw new InsufficientYieldPositionError(totalAvailable, requestedUsyc);
  }

  const wallet = await prisma.wallet.findUnique({ where: { id: bucket.walletId } });
  if (!wallet) throw new YieldError("Bucket's wallet not found.");

  // Consume oldest positions first (FIFO) until the requested amount is
  // covered, creating one YieldRedemptionRequest row per position touched
  // — keeps each request's cost-basis math exact (via its own
  // YieldPosition.navAtDeploy) rather than blended across positions
  // deployed at different NAVs.
  let remaining = requestedUsyc;
  const createdRequests: YieldRedemptionRequest[] = [];

  for (const { position, available } of availablePositions) {
    if (remaining <= 0n) break;
    const takeFromThis = remaining < available ? remaining : available;
    remaining -= takeFromThis;

    const idempotencyKey = `yield-redeem-${randomUUID()}`;

    const request = await prisma.yieldRedemptionRequest.create({
      data: {
        ledgerAccountId: params.ledgerAccountId,
        yieldPositionId: position.id,
        usycAmountRequested: takeFromThis,
        status: "PENDING",
        idempotencyKey,
      },
    });

    createdRequests.push(request);

    // Submit to Circle right after creating the row so a request never
    // sits at PENDING without an in-flight Circle order behind it for
    // long. If THIS submission throws, the row stays PENDING (not
    // FAILED) so a retry (via a periodic reconciliation sweep, or the
    // user retrying) can pick it back up rather than requiring a
    // brand-new request — see submitRedemptionToCircle.
    submitRedemptionToCircle(request.id, wallet.circleWalletId, takeFromThis, idempotencyKey).catch(
      (err) =>
        console.error(
          `[yield] initial redemption submission failed for request ${request.id}, will retry`,
          err
        )
    );
  }

  return { requests: createdRequests, totalUsycAmountRequested: requestedUsyc };
}

async function getPendingRedemptionAmountsByPosition(
  positionIds: string[]
): Promise<Map<string, bigint>> {
  if (positionIds.length === 0) return new Map();

  const pending = await prisma.yieldRedemptionRequest.groupBy({
    by: ["yieldPositionId"],
    where: { yieldPositionId: { in: positionIds }, status: { in: ["PENDING", "PROCESSING"] } },
    _sum: { usycAmountRequested: true },
  });

  return new Map(pending.map((p) => [p.yieldPositionId, p._sum.usycAmountRequested ?? 0n]));
}

async function submitRedemptionToCircle(
  requestId: string,
  circleWalletId: string,
  usycAmount: bigint,
  idempotencyKey: string
): Promise<void> {
  // Leaving status at PENDING (not FAILED) on a thrown error is
  // deliberate — a submission failure here (network blip, transient
  // Circle error) should be retried, not require the user to file a
  // whole new redemption request. Only jobs/confirmYieldRedemption.ts
  // ever marks a request terminally FAILED, and only once Circle itself
  // reports a terminal failure state.
  const conversion = await createUsycConversion({
    walletId: circleWalletId,
    direction: "USYC_TO_USDC",
    amount: toDecimalString(usycAmount),
    idempotencyKey,
  });

  await prisma.yieldRedemptionRequest.update({
    where: { id: requestId },
    data: { status: "PROCESSING", circleConversionId: conversion.circleConversionId },
  });

  await enqueueRedemptionConfirmation(requestId);
}

async function enqueueRedemptionConfirmation(requestId: string): Promise<void> {
  try {
    const queue = getQueue(QUEUE_NAMES.YIELD_REDEMPTION_CONFIRMATION);
    await queue.add(
      "confirm-redemption",
      { yieldRedemptionRequestId: requestId },
      {
        attempts: 20,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  } catch (err) {
    console.error(
      `[yield] failed to enqueue redemption confirmation for ${requestId}. ` +
        `A periodic reconciliation sweep should still pick this up.`,
      err
    );
  }
}

/**
 * Manual retry for a redemption request stuck at PENDING (never
 * successfully submitted to Circle) — the equivalent of
 * lib/payroll/execution.ts#retryPayrollRunItem for this feature. Safe to
 * call repeatedly; a no-op once the request has moved past PENDING.
 */
export async function retryRedemptionSubmission(
  orgId: string,
  ledgerAccountId: string,
  requestId: string
): Promise<void> {
  const request = await prisma.yieldRedemptionRequest.findFirst({
    where: { id: requestId, ledgerAccountId, ledgerAccount: { orgId } },
  });
  if (!request) throw new YieldError("Redemption request not found.");
  if (request.status !== "PENDING") return; // already submitted or terminal — nothing to retry

  const bucket = await getBucket(orgId, ledgerAccountId);
  const wallet = await prisma.wallet.findUnique({ where: { id: bucket.walletId } });
  if (!wallet) throw new YieldError("Bucket's wallet not found.");

  const idempotencyKey = request.idempotencyKey ?? `yield-redeem-${randomUUID()}`;
  await submitRedemptionToCircle(
    request.id,
    wallet.circleWalletId,
    request.usycAmountRequested,
    idempotencyKey
  );
}