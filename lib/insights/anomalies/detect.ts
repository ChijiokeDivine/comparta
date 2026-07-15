// lib/insights/anomalies/detect.ts
//
// Two lightweight, purely statistical checks against a single confirmed
// outbound OnchainTransaction — no ML model, just trailing averages, per
// the spec's "lightweight job" framing. Never blocks or reverses
// anything; only ever creates an informational SpendingAnomaly row.
// "Worth a second look," never an accusation — see the schema comment on
// SpendingAnomaly.message for why the wording is baked in here rather
// than left to a UI to phrase.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { resolveCounterpartyDisplayName } from "@/lib/insights/counterparty";
import type { SpendingAnomaly } from "@/app/generated/prisma/client";

const TRAILING_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A trailing average computed from fewer than this many prior
// transactions isn't trustworthy enough to call anything "3x normal" —
// an org's 4th-ever outbound payment shouldn't get flagged just because
// its 3 predecessors happened to be small. Below this sample size, the
// LARGE_OUTFLOW check is skipped entirely (not flagged, not silently
// "no anomaly" logged as a false negative — genuinely not enough data
// to judge).
const MIN_SAMPLE_SIZE_FOR_AVERAGE = 5;

const LARGE_OUTFLOW_MULTIPLIER = 3;
const NEW_COUNTERPARTY_MULTIPLIER = 2;

// Fallback flag for a new counterparty's first payment when the org has
// NO trailing average at all yet (e.g. this is genuinely one of the
// org's first several transactions) — an absolute floor so a brand-new
// org's very first big payment can still be flagged rather than only
// ever comparing against averages that don't exist yet. Smallest USDC
// unit: 5,000.00 USDC.
const NEW_COUNTERPARTY_ABSOLUTE_FLOOR = 5_000_000_000n;

export interface DetectAnomaliesResult {
  flagged: SpendingAnomaly[];
}

/**
 * Runs both checks against one transaction. Idempotent: upserts on
 * (onchainTransactionId, type) — safe to call more than once for the
 * same transaction (e.g. re-run by the sweep, or a manual re-check) with
 * no duplicate flags.
 */
export async function detectAnomaliesForTransaction(
  onchainTransactionId: string
): Promise<DetectAnomaliesResult> {
  const tx = await prisma.onchainTransaction.findUnique({
    where: { id: onchainTransactionId },
    include: { wallet: { select: { orgId: true } } },
  });

  if (!tx || tx.direction !== "OUT" || tx.status !== "CONFIRMED") {
    return { flagged: [] };
  }

  const orgId = tx.wallet.orgId;
  const flagged: SpendingAnomaly[] = [];

  const trailingAverage = await computeTrailingAverageOutflow(orgId, tx.id, tx.createdAt);

  // ── LARGE_OUTFLOW ──
  if (trailingAverage !== null && trailingAverage > 0n) {
    const multiplier = Number(tx.amount) / Number(trailingAverage);
    if (multiplier >= LARGE_OUTFLOW_MULTIPLIER) {
      const displayName = await resolveCounterpartyDisplayName(orgId, tx.counterpartyAddress);
      const anomaly = await upsertAnomaly(orgId, tx.id, "LARGE_OUTFLOW", {
        message:
          `This ${toDecimalString(tx.amount)} USDC payment to ${displayName} is about ` +
          `${multiplier.toFixed(1)}x your trailing 90-day average outflow of ` +
          `${toDecimalString(trailingAverage)} USDC — worth a second look.`,
        transactionAmount: tx.amount,
        comparisonAmount: trailingAverage,
        multiplier,
      });
      flagged.push(anomaly);
    }
  }

  // ── NEW_COUNTERPARTY_LARGE_PAYMENT ──
  const isFirstPayment = await isFirstPaymentToCounterparty(
    orgId,
    tx.counterpartyAddress,
    tx.id,
    tx.createdAt
  );

  if (isFirstPayment) {
    const multiplier =
      trailingAverage !== null && trailingAverage > 0n
        ? Number(tx.amount) / Number(trailingAverage)
        : null;
    const largeRelativeToAverage = multiplier !== null && multiplier >= NEW_COUNTERPARTY_MULTIPLIER;
    const largeInAbsoluteTerms = trailingAverage === null && tx.amount >= NEW_COUNTERPARTY_ABSOLUTE_FLOOR;

    if (largeRelativeToAverage || largeInAbsoluteTerms) {
      const displayName = await resolveCounterpartyDisplayName(orgId, tx.counterpartyAddress);
      const message =
        multiplier !== null
          ? `The first-ever payment to ${displayName} was ${toDecimalString(tx.amount)} USDC — about ` +
            `${multiplier.toFixed(1)}x your trailing 90-day average outflow — worth a second look before it becomes a pattern.`
          : `The first-ever payment to ${displayName} was ${toDecimalString(tx.amount)} USDC — worth a second look before it becomes a pattern.`;

      const anomaly = await upsertAnomaly(orgId, tx.id, "NEW_COUNTERPARTY_LARGE_PAYMENT", {
        message,
        transactionAmount: tx.amount,
        comparisonAmount: trailingAverage,
        multiplier,
      });
      flagged.push(anomaly);
    }
  }

  return { flagged };
}

/** Average OUT/CONFIRMED transaction amount for this org in the 90 days before `asOf`, excluding `excludeTxId` itself. Null if fewer than MIN_SAMPLE_SIZE_FOR_AVERAGE prior transactions exist. */
async function computeTrailingAverageOutflow(
  orgId: string,
  excludeTxId: string,
  asOf: Date
): Promise<bigint | null> {
  const since = new Date(asOf.getTime() - TRAILING_WINDOW_DAYS * MS_PER_DAY);

  const priorOutflows = await prisma.onchainTransaction.findMany({
    where: {
      wallet: { orgId },
      direction: "OUT",
      status: "CONFIRMED",
      id: { not: excludeTxId },
      createdAt: { gte: since, lt: asOf },
    },
    select: { amount: true },
  });

  if (priorOutflows.length < MIN_SAMPLE_SIZE_FOR_AVERAGE) return null;

  const total = priorOutflows.reduce((sum, t) => sum + t.amount, 0n);
  return total / BigInt(priorOutflows.length);
}

/** Whether `tx` is the first CONFIRMED OUT transaction this org has ever sent to `counterpartyAddress`. */
async function isFirstPaymentToCounterparty(
  orgId: string,
  counterpartyAddress: string,
  excludeTxId: string,
  asOf: Date
): Promise<boolean> {
  const priorPayment = await prisma.onchainTransaction.findFirst({
    where: {
      wallet: { orgId },
      direction: "OUT",
      status: "CONFIRMED",
      counterpartyAddress,
      id: { not: excludeTxId },
      createdAt: { lt: asOf },
    },
    select: { id: true },
  });
  return !priorPayment;
}

interface UpsertAnomalyFields {
  message: string;
  transactionAmount: bigint;
  comparisonAmount: bigint | null;
  multiplier: number | null;
}

async function upsertAnomaly(
  orgId: string,
  onchainTransactionId: string,
  type: "LARGE_OUTFLOW" | "NEW_COUNTERPARTY_LARGE_PAYMENT",
  fields: UpsertAnomalyFields
): Promise<SpendingAnomaly> {
  return prisma.spendingAnomaly.upsert({
    where: { onchainTransactionId_type: { onchainTransactionId, type } },
    create: { orgId, onchainTransactionId, type, ...fields },
    // Deliberately don't touch `status` on update — if a user already
    // DISMISSED this flag, a re-run of the sweep must never resurrect it
    // by resetting status back to OPEN. Only the message/comparison
    // numbers refresh (e.g. the trailing average shifted slightly).
    update: fields,
  });
}