// lib/paj/webhookState.ts
//
// Pure state rules for Paj order updates. Kept free of Prisma and crypto so
// the money-safety behaviour can be unit-tested without a database.
//
// Why this exists: Paj posts the WHOLE order on every transition and retries
// failed deliveries. Deliveries can therefore arrive out of order (a retried
// PROCESSING after COMPLETED) and more than once. An order must never move
// backwards, and a terminal state must never be overwritten by a late or
// duplicated delivery — otherwise a completed payout could be shown as failed,
// or vice versa.

import type { PajOrderStatus, PajOrderType } from "@/app/generated/prisma/client";

export interface PajStatusTransition {
  /** Whether the order row should be updated at all (enrichment included). */
  apply: boolean;
  /** The status to store, or null when the delivery carried none we know. */
  nextStatus: PajOrderStatus | null;
  /** Whether the status itself changes (false = metadata-only update). */
  changed: boolean;
  reason?: string;
}

const RANK: Record<PajOrderStatus, number> = {
  INIT: 0,
  PROCESSING: 1,
  COMPLETED: 2,
  ERROR: 2,
};

export function isTerminalPajStatus(status: PajOrderStatus): boolean {
  return status === "COMPLETED" || status === "ERROR";
}

/**
 * Decide what a delivery's status means for the locally stored order.
 *
 * - Same status: apply (enrich amounts/rate/signature) but don't move the
 *   state or reset timestamps.
 * - Forward move: apply.
 * - Backwards move, or anything after a terminal state: ignore. ERROR is
 *   terminal, as Paj documents, so a later COMPLETED does not revive a failed
 *   order automatically — an operator can reprocess it from Settings if Paj
 *   genuinely corrected itself.
 */
export function resolveStatusTransition(
  current: PajOrderStatus,
  incoming: PajOrderStatus | null
): PajStatusTransition {
  if (!incoming) {
    return {
      apply: false,
      nextStatus: null,
      changed: false,
      reason: "Delivery carried no recognised order status.",
    };
  }

  if (current === incoming) {
    return { apply: true, nextStatus: incoming, changed: false };
  }

  if (isTerminalPajStatus(current)) {
    return {
      apply: false,
      nextStatus: null,
      changed: false,
      reason: `Ignored ${incoming} after terminal ${current}.`,
    };
  }

  if (RANK[incoming] < RANK[current]) {
    return {
      apply: false,
      nextStatus: null,
      changed: false,
      reason: `Ignored backwards transition ${current} → ${incoming}.`,
    };
  }

  return { apply: true, nextStatus: incoming, changed: true };
}

/**
 * Paj's `transactionType` is `ON_RAMP` / `OFF_RAMP`. Comparing it to our
 * stored order type protects against a mis-routed or reused id: an offramp
 * update must never be written onto an onramp order.
 */
export function pajTransactionTypeMatchesOrder(
  transactionType: string | null | undefined,
  orderType: PajOrderType
): boolean {
  if (!transactionType) return true; // absent field: don't block a valid update
  const normalized = transactionType.replace(/_/g, "").toUpperCase();
  return normalized === (orderType === "ONRAMP" ? "ONRAMP" : "OFFRAMP");
}
