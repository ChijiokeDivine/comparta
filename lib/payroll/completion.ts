// lib/payroll/completion.ts
//
// Mirrors a resolved OnchainTransaction (CONFIRMED or FAILED) back onto
// the PayrollRunItem it belongs to. Called from jobs/confirmTransaction.ts
// after it updates OnchainTransaction.status — same "best-effort,
// post-commit follow-up" posture as
// lib/paymentLinks/reconciliation.ts/lib/invoices/reconciliation.ts:
// never let a hook failure here affect the underlying transaction
// confirmation/reversal, which has already committed by the time this
// runs.

import { prisma } from "@/lib/db/prisma";
import type { OnchainTransaction } from "@/app/generated/prisma/client";

/**
 * Call this AFTER jobs/confirmTransaction.ts has updated
 * onchainTx.status to a terminal state. No-op for any transaction that
 * isn't a payroll disbursement (referenceType !== "PAYROLL_RUN") or that
 * doesn't match a known PayrollRunItem (e.g. txId was already cleared by
 * a manual retry). Never throws — logs and returns instead, since a
 * missed update here just means the item's status lags the onchain
 * truth until the next reconciliation pass, not a lost payment (the
 * ledger reversal in confirmTransaction.ts already happened
 * independently of this).
 */
export async function handlePayrollTransactionResolved(onchainTx: OnchainTransaction): Promise<void> {
  if (onchainTx.referenceType !== "PAYROLL_RUN") return;
  if (onchainTx.status !== "CONFIRMED" && onchainTx.status !== "FAILED") return;

  try {
    const item = await prisma.payrollRunItem.findUnique({ where: { txId: onchainTx.id } });
    if (!item) return; // not (or no longer) linked to a payroll run item
    if (item.status !== "SENT") return; // already handled, or moved on via retry — idempotent

    if (onchainTx.status === "CONFIRMED") {
      await prisma.payrollRunItem.update({
        where: { id: item.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      return;
    }

    // FAILED: confirmTransaction.ts has already reversed the ledger
    // debit by this point. Flag the item as FAILED with a reason that
    // makes the retry path obvious.
    await prisma.payrollRunItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        failureReason:
          "The onchain transaction failed after submission; funds were returned to the source bucket. Retry to resend.",
      },
    });
  } catch (err) {
    console.error(`[payroll] failed to reconcile PayrollRunItem for onchainTransaction ${onchainTx.id}`, err);
  }
}