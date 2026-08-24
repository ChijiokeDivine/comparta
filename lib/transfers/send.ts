// lib/transfers/send.ts
//
// The generic outbound transfer primitive. Every feature that moves money
// out of an org's wallet - a manual send, an invoice payout, a payroll
// run, a DCA execution - calls sendPayment() rather than talking to the
// ledger engine or Circle directly.
//
// IDEMPOTENCY MODEL (post-App-Kit-migration):
//   App Kit's kit.send() has no dedup/idempotency parameter (see
//   lib/circle/appKit.ts) - there is no way to ask Circle "only do this
//   once." So this function cannot make the Circle call itself safe to
//   retry. What it CAN guarantee is that IT never calls kit.send() twice
//   for the same idempotencyKey:
//
//     1. upsert an OnchainTransaction row keyed on idempotencyKey,
//        status=PENDING, BEFORE calling Circle
//     2. atomically claim it (submittedAt: null -> now) right before the
//        Circle call - this is a compare-and-swap, so two concurrent
//        callers with the same key can never both claim it
//     3. call Circle
//     4. on a definitive rejection, un-claim (submittedAt -> null,
//        status -> FAILED) so a retry is safe
//     5. on anything else going wrong after the call was made (crash,
//        timeout, unknown response) - do NOT un-claim. The row is left
//        PENDING with submittedAt set. This is the "unknown, don't
//        touch" state; only lib/circle/reconciliation.ts may resolve it,
//        by asking Circle directly what actually happened.
//     6. on success, write CONFIRMED, then debit the ledger via
//        recordEntry() keyed on the OnchainTransaction id - recordEntry
//        is itself idempotent (unique constraint on
//        [referenceType, referenceId, direction]), so this step alone is
//        safe to retry/replay even without the outer guard above.
//
// A retried request (same idempotencyKey) short-circuits to a replay of
// the stored result once CONFIRMED, and is REFUSED (not retried) while
// PENDING+submittedAt - see step 5. This trades availability for safety:
// we would rather make the caller wait/poll than risk a double on-chain
// send that nothing can undo.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { resolve, ResolverError } from "@/lib/identity/resolver";
import { recordEntry, getBalance, InsufficientBalanceError as LedgerInsufficientBalanceError } from "@/lib/ledger/engine";
import { sendTransaction as circleSendTransaction, CircleApiError } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { touchContactLastPaid } from "@/lib/contacts/service";
import { executeOutgoingPaymentSavingsRules } from "@/lib/savings/sweep";
import { handlePayrollTransactionResolved } from "@/lib/payroll/completion";
import type { LedgerReferenceType, OnchainTransaction } from "@/app/generated/prisma/client";

export class SendPaymentError extends Error {
  constructor(message: string, public readonly code: SendErrorCode) {
    super(message);
    this.name = "SendPaymentError";
  }
}

export type SendErrorCode =
  | "INVALID_RECIPIENT"
  | "SELF_SEND"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "PROVIDER_ERROR"
  | "ACCOUNT_NOT_FOUND"
  | "ALREADY_IN_FLIGHT";

export interface SendPaymentInput {
  orgId: string;
  fromLedgerAccountId: string;
  toIdentifier: string;
  /** Decimal string, e.g. "125.50". Must have at most 6 decimal places (USDC precision). */
  amount: string;
  memo?: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  /** The dedup key for this logical send. Auto-generated if omitted - but
   * callers that might retry (e.g. the HTTP route) MUST pass the same
   * value on every retry of the same logical attempt, or idempotency is
   * meaningless. */
  idempotencyKey?: string;
}

export interface SendPaymentResult {
  onchainTransactionId: string;
  circleTransactionId: string;
  status: "CONFIRMED";
  amount: string; // decimal string
  toAddress: string;
  toOrgId?: string;
  toDisplayName?: string;
}

function buildResult(
  onchainTx: OnchainTransaction,
  resolved: { address: string; orgId?: string; displayName?: string }
): SendPaymentResult {
  return {
    onchainTransactionId: onchainTx.id,
    circleTransactionId: onchainTx.circleTransactionId ?? "",
    status: "CONFIRMED",
    amount: toDecimalString(onchainTx.amount),
    toAddress: resolved.address,
    toOrgId: resolved.orgId,
    toDisplayName: resolved.displayName,
  };
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  // 1. Resolve recipient.
  let resolved: Awaited<ReturnType<typeof resolve>>;
  try {
    resolved = await resolve(input.toIdentifier);
  } catch (err) {
    if (err instanceof ResolverError) {
      throw new SendPaymentError(err.message, "INVALID_RECIPIENT");
    }
    throw err;
  }

  // 2. Reject self-send.
  if (resolved.orgId && resolved.orgId === input.orgId) {
    throw new SendPaymentError("You can't send a payment to yourself.", "SELF_SEND");
  }

  // 3. Validate amount.
  let amountSmallestUnit: bigint;
  try {
    amountSmallestUnit = toSmallestUnit(input.amount);
  } catch {
    throw new SendPaymentError(
      `"${input.amount}" isn't a valid USDC amount. USDC supports at most 6 decimal places.`,
      "INVALID_AMOUNT"
    );
  }
  if (amountSmallestUnit <= 0n) {
    throw new SendPaymentError("Amount must be greater than zero.", "INVALID_AMOUNT");
  }

  // 4. Fast-fail balance check. Not the atomic guard (recordEntry's row
  // lock is) - avoids submitting to Circle at all for an obviously-
  // insufficient balance.
  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: { id: input.fromLedgerAccountId, orgId: input.orgId },
    include: { wallet: true },
  });
  if (!ledgerAccount) {
    throw new SendPaymentError("Source ledger account not found.", "ACCOUNT_NOT_FOUND");
  }

  const currentBalance = await getBalance(ledgerAccount.id);
  if (currentBalance < amountSmallestUnit) {
    throw new SendPaymentError(
      `Insufficient balance: this account has ${toDecimalString(currentBalance)} USDC available.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  // 5. Find or create the write-ahead row, BEFORE calling Circle.
  let onchainTx = await prisma.onchainTransaction.findUnique({ where: { idempotencyKey } });

  if (onchainTx) {
    if (onchainTx.status === "CONFIRMED") {
      // Pure replay - a retry of a request that already succeeded.
      return buildResult(onchainTx, resolved);
    }
    if (onchainTx.status === "PENDING" && onchainTx.submittedAt) {
      // We called Circle for this key and never learned the outcome.
      // There is nothing safe to do here but refuse - see module docstring.
      throw new SendPaymentError(
        "This payment is still being confirmed. Please don't retry - check back shortly.",
        "ALREADY_IN_FLIGHT"
      );
    }
    // status === "PENDING" with submittedAt null (crashed before the
    // claim step), or status === "FAILED" (Circle definitively rejected
    // last time, submittedAt was cleared) - both safe to reuse.
  } else {
    try {
      onchainTx = await prisma.onchainTransaction.create({
        data: {
          walletId: ledgerAccount.walletId,
          fromLedgerAccountId: ledgerAccount.id,
          direction: "OUT",
          amount: amountSmallestUnit,
          counterpartyAddress: resolved.address,
          chain: ledgerAccount.wallet.chain,
          sourceChain: ledgerAccount.wallet.chain,
          status: "PENDING",
          idempotencyKey,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          memo: input.memo,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // Lost a create race against a concurrent identical request -
        // adopt whichever row won and re-run the same checks against it.
        onchainTx = await prisma.onchainTransaction.findUniqueOrThrow({ where: { idempotencyKey } });
        if (onchainTx.status === "CONFIRMED") return buildResult(onchainTx, resolved);
        if (onchainTx.status === "PENDING" && onchainTx.submittedAt) {
          throw new SendPaymentError(
            "This payment is still being confirmed. Please don't retry - check back shortly.",
            "ALREADY_IN_FLIGHT"
          );
        }
      } else {
        throw err;
      }
    }
  }

  // 6. Atomically claim the row right before calling Circle. This is a
  // compare-and-swap on submittedAt: only one caller can win it, closing
  // the race between step 5's read and this write.
  const claim = await prisma.onchainTransaction.updateMany({
    where: { id: onchainTx.id, submittedAt: null },
    data: { status: "PENDING", submittedAt: new Date() },
  });
  if (claim.count === 0) {
    // Someone else claimed it between our read and here.
    const fresh = await prisma.onchainTransaction.findUniqueOrThrow({ where: { id: onchainTx.id } });
    if (fresh.status === "CONFIRMED") return buildResult(fresh, resolved);
    throw new SendPaymentError(
      "This payment is still being confirmed. Please don't retry - check back shortly.",
      "ALREADY_IN_FLIGHT"
    );
  }

  // 7. Submit to Circle. No dedup key reaches Circle here - App Kit
  // doesn't support one (see lib/circle/appKit.ts). Everything above
  // exists to guarantee we only ever get here once per idempotencyKey.
  let circleResult: Awaited<ReturnType<typeof circleSendTransaction>>;
  try {
    circleResult = await circleSendTransaction(
      ledgerAccount.wallet.arcAddress,
      resolved.address,
      amountSmallestUnit,
      ledgerAccount.wallet.chain,
      idempotencyKey
    );
  } catch (err) {
    if (err instanceof CircleApiError) {
      // A definitive, known rejection - safe to un-claim so a retry with
      // the same idempotencyKey can try again.
      await prisma.onchainTransaction.update({
        where: { id: onchainTx.id },
        data: { status: "FAILED", submittedAt: null },
      });
      console.error("[sendPayment] Circle submission failed", err.cause ?? err);
      throw new SendPaymentError(
        "We couldn't submit this payment right now. Please try again in a moment.",
        "PROVIDER_ERROR"
      );
    }
    // Anything else (timeout, network error, process about to die) -
    // outcome unknown. Leave status=PENDING, submittedAt set. Do NOT
    // un-claim. lib/circle/reconciliation.ts resolves this later.
    console.error(
      `[sendPayment] CRITICAL: Circle call for OnchainTransaction ${onchainTx.id} ` +
        `(idempotencyKey ${idempotencyKey}) did not complete cleanly - outcome unknown, ` +
        `left PENDING for reconciliation.`,
      err
    );
    throw new SendPaymentError(
      "This payment may have been submitted but we couldn't confirm it. Our team has been notified - please don't retry until you hear back.",
      "PROVIDER_ERROR"
    );
  }

  // Wraps every step AFTER the Circle send resolved (step 8 onward) in a
  // catch-all. Money has already left custody at this point; anything that
  // fails here (ledger debit race, final P2002 fallback that somehow
  // missed, DB blip) MUST be surfaced to the caller as a soft PROVIDER_ERROR
  // - NEVER as an unhandled 5xx that shows "Failed to send payment" in the
  // UI, because the payment DID send successfully on-chain and all we
  // couldn't do was finish our local bookkeeping. The SendPaymentError
  // code=PROVIDER_ERROR (HTTP 502 in route.ts) tells the UI "payment may
  // have been submitted, please don't retry" - exactly the right posture.
  try {

  // 8. Mark confirmed. Split into TWO writes so a unique constraint
  // collision never leaves the row half-updated / stuck PENDING:
  //   a. First update status + confirmedAt (no unique keys — CAN'T collide).
  //      If this fails (row was concurrently adopted/deleted), fall through
  //      to the adoption path below.
  //   b. Then set txHash + circleTransactionId (both @unique) one at a time,
  //      each wrapped in its own P2002 handler. If either collides, we
  //      ADOPT whichever row already claimed that unique key, because
  //      multiple independent observers (send.ts sync caller, receive.ts
  //      inbound webhook, reconciliation sweep, confirmTransaction job)
  //      all observe the SAME on-chain settlement and can race to record
  //      it. The adoption uses identity-filter-by-id first so we don't
  //      accidentally merge a completely unrelated transaction.
  //   c. If we can't write the unique keys to OUR row (someone else's row
  //      owns them), adopt their row (status first, then return it).
  let confirmedTx: OnchainTransaction;
  const newHash = circleResult.circleTransactionId;
  try {
    confirmedTx = await prisma.onchainTransaction.update({
      where: { id: onchainTx.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
  } catch (_err) {
    const orphan = await prisma.onchainTransaction.findUnique({ where: { id: onchainTx.id } });
    if (!orphan || orphan.status === "CONFIRMED") {
      confirmedTx = orphan ?? onchainTx;
    } else {
      throw _err;
    }
  }

  for (const field of ["txHash", "circleTransactionId"] as const) {
    try {
      const patch = await prisma.onchainTransaction.update({
        where: { id: confirmedTx.id },
        data: { [field]: newHash },
      });
      confirmedTx = patch;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;

      const adopted = await prisma.onchainTransaction.findFirst({
        where: { OR: [{ txHash: newHash }, { circleTransactionId: newHash }] },
      });
      if (!adopted) throw err;

      if (adopted.id === confirmedTx.id) {
        break;
      }

      if (
        adopted.walletId === confirmedTx.walletId &&
        adopted.direction === confirmedTx.direction &&
        adopted.amount === confirmedTx.amount &&
        adopted.counterpartyAddress === confirmedTx.counterpartyAddress
      ) {
        console.warn(
          `[sendPayment] adopting OnchainTransaction ${adopted.id} instead of ${confirmedTx.id} ` +
            `for ${field}=${newHash} - both rows describe the same ${confirmedTx.direction} transfer ` +
            `of ${confirmedTx.amount} to ${confirmedTx.counterpartyAddress} on wallet ${confirmedTx.walletId}.`
        );
      } else {
        console.warn(
          `[sendPayment] adopting OnchainTransaction ${adopted.id} for ${field}=${newHash} even though ` +
            `it doesn't perfectly match our row ${confirmedTx.id} (wallet ${adopted.walletId}/${confirmedTx.walletId}, ` +
            `dir ${adopted.direction}/${confirmedTx.direction}, amt ${adopted.amount}/${confirmedTx.amount}). ` +
            `Unique key collision wins - downstream ledger debit uses adopted row id.`
        );
      }

      if (adopted.status !== "CONFIRMED") {
        try {
          const patched = await prisma.onchainTransaction.update({
            where: { id: adopted.id },
            data: { status: "CONFIRMED", confirmedAt: confirmedTx.confirmedAt ?? new Date() },
          });
          confirmedTx = patched;
        } catch (_patchErr) {
          const reloaded = await prisma.onchainTransaction.findUniqueOrThrow({ where: { id: adopted.id } });
          confirmedTx = reloaded;
        }
      } else {
        confirmedTx = adopted;
      }

      break;
    }
  }

  // 9. Debit the ledger. recordEntry is idempotent on
  // [referenceType, referenceId, direction] - safe even if a previous
  // attempt already got this far and only failed afterward.
  try {
    await recordEntry({
      ledgerAccountId: ledgerAccount.id,
      amount: amountSmallestUnit,
      direction: "DEBIT",
      referenceType: "ONCHAIN_TX",
      referenceId: confirmedTx.id,
    });
  } catch (err) {
    if (err instanceof LedgerInsufficientBalanceError) {
      // Extremely rare race (fast-fail passed, but the atomic debit lost
      // to a concurrent drain). Funds already left custody - this still
      // needs a human, but the OnchainTransaction row is CONFIRMED and
      // will never be resubmitted, so there's no double-send risk left,
      // only a bookkeeping one.
      console.error(
        `[sendPayment] CRITICAL: onchainTx ${confirmedTx.id} confirmed but ledger debit failed ` +
          `on insufficient balance (race). Manual reconciliation of the LEDGER (not Circle) needed.`,
        err
      );
      throw new SendPaymentError(
        "This payment could not be completed due to a balance conflict. Our team has been notified.",
        "INSUFFICIENT_BALANCE"
      );
    }
    throw err;
  }

  // 10. Post-commit hooks - best-effort, never thrown, safe to re-run.
  handlePayrollTransactionResolved(confirmedTx).catch((err) =>
    console.error(`[sendPayment] payroll completion hook failed for onchainTx ${confirmedTx.id}`, err)
  );
  touchContactLastPaid(input.orgId, input.toIdentifier.trim()).catch(() => {});
  executeOutgoingPaymentSavingsRules({
    orgId: input.orgId,
    sourceLedgerAccountId: input.fromLedgerAccountId,
    debitedAmount: amountSmallestUnit,
    triggerReferenceType: "ONCHAIN_TX",
    triggerReferenceId: confirmedTx.id,
  }).catch((err) => console.error(`[sendPayment] savings rules failed for onchainTx ${confirmedTx.id}`, err));

  return buildResult(confirmedTx, resolved);

  } catch (lateErr) {
    console.error(
      `[sendPayment] Circle send resolved (txHash=${circleResult.circleTransactionId}) but a post-submit step ` +
        `failed. Money has ALREADY left the wallet on-chain; DO NOT LET THE CALLER RETRY. Late error:`,
      lateErr
    );
    if (lateErr instanceof SendPaymentError) {
      if (lateErr.code === "INSUFFICIENT_BALANCE") throw lateErr;
    }
    throw new SendPaymentError(
      "The payment has been submitted to the network. Please don't retry — our team is verifying the final status.",
      "PROVIDER_ERROR"
    );
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}