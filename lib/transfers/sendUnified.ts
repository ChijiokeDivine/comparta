// lib/transfers/sendUnified.ts
//
// The Unified Balance counterpart to lib/transfers/send.ts's sendPayment().
// Kept as a SEPARATE function rather than folded into sendPayment(),
// because the two are shaped differently at the core:
//   - sendPayment() resolves toIdentifier (a Comparta username or contact)
//     via lib/identity/resolver.ts, and always settles on the wallet's own
//     chain (Arc). It's "pay someone in Comparta."
//   - sendUnifiedBalancePayment() (this file) takes a raw destination
//     address on a caller-chosen chain — there is no Comparta identity to
//     resolve, and no self-send check makes sense against an arbitrary
//     external address. It's "move funds out to any supported chain."
// Reusing sendPayment()'s body with a bunch of `if (destinationChain)`
// branches would have made the already-intricate idempotency dance in
// that file harder to read for both cases. This file instead COPIES that
// idempotency pattern (same OnchainTransaction table, same PENDING ->
// claim -> submit -> CONFIRMED states, same "unknown outcome, leave
// PENDING for reconciliation" posture) rather than the code, so a bug fix
// to one may need porting to the other — see send.ts's module docstring
// for the full rationale behind the pattern being copied.
//
// WHAT'S DELIBERATELY NOT WIRED IN HERE (unlike sendPayment()):
// touchContactLastPaid, executeOutgoingPaymentSavingsRules, and the
// payroll-completion hook are all Comparta-internal-identity concepts
// (a "contact," a savings rule keyed to the org's own buckets). A raw
// external cross-chain address doesn't fit that model cleanly, so this
// function does the ledger debit and nothing else post-commit. Add these
// back in per your own product decision if outgoing Unified Balance
// spends should also trigger them.
//
// JUST-IN-TIME TOP-UP (step 5.5 below): a cross-chain spend draws ONLY
// from Circle Gateway's confirmed Unified Balance, which is a DIFFERENT
// number from this org's ledger balance checked in step 3 — the ledger
// includes Arc-native funds that were never deposited into Gateway (see
// lib/circle/autoDeposit.ts's module docstring for why that's
// deliberate). So passing the step-3 ledger check does NOT guarantee
// Gateway has enough confirmed to actually execute the spend. Before
// step 6 submits, ensureUnifiedBalanceCovers() closes that gap by
// depositing just enough — this is what actually makes "the user doesn't
// have to think about depositing first" true.
//
// Two things that were WRONG in an earlier version of this flow, now
// fixed, worth remembering if this ever regresses:
//   1. The top-up and the step-3 balance check were both targeting the
//      bare transfer amount, not amount + Gateway's fee for this spend
//      (estimateUnifiedBalanceSpendFee, computed once against the exact
//      params spend() will use). A send could pass every check and still
//      fail at Circle for lacking the ~$0.20-0.30 fee on top. Both checks
//      now target `totalCost = amount + feeEstimate`, and step 7's ledger
//      debit charges totalCost too — this is what "fees come out of the
//      user's own balance" means concretely: the fee is folded into what
//      the org's bucket is debited, not an untracked drain on Gateway.
//   2. ensureUnifiedBalanceCovers() used to assume a deposit was
//      immediately spendable once the deposit call resolved. It isn't —
//      Gateway confirms a deposit on its own attestation timeline, even
//      for Arc's fast finality — so it now actively waits
//      (waitForConfirmedBalance) until the target is actually confirmed
//      before this function returns, rather than racing straight into
//      spend() and hitting a confusing BALANCE_INSUFFICIENT_TOKEN error
//      for money that had, from this codebase's point of view, already
//      "arrived."

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { recordEntry, getBalance, InsufficientBalanceError as LedgerInsufficientBalanceError } from "@/lib/ledger/engine";
import { sendUnifiedBalancePayment as circleSendUnified, CircleApiError } from "@/lib/circle/wallets";
import { UnifiedBalanceUnsupportedChainError, estimateUnifiedBalanceSpendFee } from "@/lib/circle/unifiedBalance";
import { ensureUnifiedBalanceCovers } from "@/lib/circle/autoDeposit";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import type { Chain, LedgerReferenceType, OnchainTransaction } from "@/app/generated/prisma/client";

export class SendUnifiedPaymentError extends Error {
  constructor(message: string, public readonly code: SendUnifiedErrorCode) {
    super(message);
    this.name = "SendUnifiedPaymentError";
  }
}

export type SendUnifiedErrorCode =
  | "INVALID_ADDRESS"
  | "UNSUPPORTED_CHAIN"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "PROVIDER_ERROR"
  | "ACCOUNT_NOT_FOUND"
  | "ALREADY_IN_FLIGHT";

export interface SendUnifiedPaymentInput {
  orgId: string;
  fromLedgerAccountId: string;
  /** Raw destination address — no Comparta identity resolution happens here. */
  toAddress: string;
  /** Which Unified-Balance-supported chain to deliver on — see
   * lib/circle/unifiedBalance.ts's UNIFIED_BALANCE_SUPPORTED_CHAINS. */
  destinationChain: Chain;
  /** Decimal string, e.g. "125.50". Must have at most 6 decimal places (USDC precision). */
  amount: string;
  memo?: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  idempotencyKey?: string;
}

export interface SendUnifiedPaymentResult {
  onchainTransactionId: string;
  circleTransactionId: string;
  status: "CONFIRMED";
  amount: string; // decimal string
  toAddress: string;
  destinationChain: Chain;
}

function buildResult(onchainTx: OnchainTransaction): SendUnifiedPaymentResult {
  return {
    onchainTransactionId: onchainTx.id,
    circleTransactionId: onchainTx.circleTransactionId ?? "",
    status: "CONFIRMED",
    amount: toDecimalString(onchainTx.amount),
    toAddress: onchainTx.counterpartyAddress,
    destinationChain: onchainTx.chain,
  };
}

export async function sendUnifiedBalancePayment(
  input: SendUnifiedPaymentInput
): Promise<SendUnifiedPaymentResult> {
  // 1. Basic address sanity check. Deliberately loose (no per-chain
  // checksum/format validation) — App Kit itself will reject a malformed
  // address, and duplicating chain-specific address validation here would
  // drift out of sync with whatever chains get added later.
  const toAddress = input.toAddress.trim();
  if (!toAddress) {
    throw new SendUnifiedPaymentError("A destination address is required.", "INVALID_ADDRESS");
  }

  // 2. Validate amount.
  let amountSmallestUnit: bigint;
  try {
    amountSmallestUnit = toSmallestUnit(input.amount);
  } catch {
    throw new SendUnifiedPaymentError(
      `"${input.amount}" isn't a valid USDC amount. USDC supports at most 6 decimal places.`,
      "INVALID_AMOUNT"
    );
  }
  if (amountSmallestUnit <= 0n) {
    throw new SendUnifiedPaymentError("Amount must be greater than zero.", "INVALID_AMOUNT");
  }

  // 3. Fast-fail balance check — against the TRUE total cost (transfer
  // amount + Gateway's fee for this exact spend), not just the bare
  // amount. Checking only the bare amount here previously let a send
  // pass this gate while still being short by the ~$0.20-0.30 fee,
  // surfacing as a confusing failure much later. Ledger, not live
  // Unified Balance — same posture as sendPayment()'s step 4. The
  // atomic guard is recordEntry's row lock in step 9 below.
  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: { id: input.fromLedgerAccountId, orgId: input.orgId },
    include: { wallet: true },
  });
  if (!ledgerAccount) {
    throw new SendUnifiedPaymentError("Source ledger account not found.", "ACCOUNT_NOT_FOUND");
  }

  // Estimated once, against the exact same params spend() will use (see
  // buildSpendParams in lib/circle/unifiedBalance.ts) — this number is
  // what "your balance, not Unified Balance, pays the fee" actually
  // means in practice: the fee is folded into what gets debited from
  // the org's own bucket (step 7), not left as an untracked drain on
  // whatever happens to be sitting in Gateway.
  const feeEstimate = await estimateUnifiedBalanceSpendFee(
    ledgerAccount.wallet.arcAddress,
    toAddress,
    amountSmallestUnit,
    input.destinationChain
  );
  const totalCost = amountSmallestUnit + feeEstimate;

  const currentBalance = await getBalance(ledgerAccount.id);
  if (currentBalance < totalCost) {
    throw new SendUnifiedPaymentError(
      `Insufficient balance: sending ${toDecimalString(amountSmallestUnit)} USDC costs ` +
        `${toDecimalString(totalCost)} USDC including network fees, but this account only has ` +
        `${toDecimalString(currentBalance)} USDC available.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  // 4. Find or create the write-ahead row, BEFORE calling Circle/App Kit.
  // Same pattern as sendPayment() steps 5-6 — see that file's module
  // docstring for the full idempotency rationale being mirrored here.
  let onchainTx = await prisma.onchainTransaction.findUnique({ where: { idempotencyKey } });

  if (onchainTx) {
    if (onchainTx.status === "CONFIRMED") {
      return buildResult(onchainTx);
    }
    if (onchainTx.status === "PENDING" && onchainTx.submittedAt) {
      throw new SendUnifiedPaymentError(
        "This payment is still being confirmed. Please don't retry - check back shortly.",
        "ALREADY_IN_FLIGHT"
      );
    }
  } else {
    try {
      onchainTx = await prisma.onchainTransaction.create({
        data: {
          walletId: ledgerAccount.walletId,
          fromLedgerAccountId: ledgerAccount.id,
          direction: "OUT",
          amount: amountSmallestUnit,
          counterpartyAddress: toAddress,
          chain: input.destinationChain,
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
        onchainTx = await prisma.onchainTransaction.findUniqueOrThrow({ where: { idempotencyKey } });
        if (onchainTx.status === "CONFIRMED") return buildResult(onchainTx);
        if (onchainTx.status === "PENDING" && onchainTx.submittedAt) {
          throw new SendUnifiedPaymentError(
            "This payment is still being confirmed. Please don't retry - check back shortly.",
            "ALREADY_IN_FLIGHT"
          );
        }
      } else {
        throw err;
      }
    }
  }

  // 5. Atomically claim the row right before calling Circle (compare-
  // and-swap on submittedAt) — same as sendPayment() step 6.
  const claim = await prisma.onchainTransaction.updateMany({
    where: { id: onchainTx.id, submittedAt: null },
    data: { status: "PENDING", submittedAt: new Date() },
  });
  if (claim.count === 0) {
    const fresh = await prisma.onchainTransaction.findUniqueOrThrow({ where: { id: onchainTx.id } });
    if (fresh.status === "CONFIRMED") return buildResult(fresh);
    throw new SendUnifiedPaymentError(
      "This payment is still being confirmed. Please don't retry - check back shortly.",
      "ALREADY_IN_FLIGHT"
    );
  }

  // 5.5. Just-in-time top-up — see module docstring. Runs AFTER claiming
  // the row (so a crash here still leaves a traceable PENDING tx) but
  // BEFORE submitting to Circle. Targets totalCost (amount + fee), not
  // just amount — topping up only the bare amount was exactly what left
  // Gateway short by the fee even when the deposit itself "succeeded."
  const coverage = await ensureUnifiedBalanceCovers(ledgerAccount.wallet, totalCost);
  if (!coverage.covered) {
    await prisma.onchainTransaction.update({
      where: { id: onchainTx.id },
      data: { status: "FAILED", submittedAt: null },
    });
    throw new SendUnifiedPaymentError(
      `Not enough USDC available across your funding chains to cover this send — short by ` +
        `${coverage.shortfall} USDC. Fund your wallet on Arc or one of the other supported chains ` +
        `and try again.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  // 6. Submit the Unified Balance spend.
  let circleResult: Awaited<ReturnType<typeof circleSendUnified>>;
  try {
    circleResult = await circleSendUnified(
      ledgerAccount.wallet.arcAddress,
      toAddress,
      amountSmallestUnit,
      input.destinationChain
    );
  } catch (err) {
    if (err instanceof CircleApiError && err.cause instanceof UnifiedBalanceUnsupportedChainError) {
      // Un-claim — this is a request-shape error (bad chain), not a
      // provider-side failure, so it's always safe to retry after fixing
      // the input.
      await prisma.onchainTransaction.update({
        where: { id: onchainTx.id },
        data: { status: "FAILED", submittedAt: null },
      });
      throw new SendUnifiedPaymentError(err.cause.message, "UNSUPPORTED_CHAIN");
    }
    if (err instanceof CircleApiError) {
      await prisma.onchainTransaction.update({
        where: { id: onchainTx.id },
        data: { status: "FAILED", submittedAt: null },
      });
      console.error("[sendUnifiedBalancePayment] Circle submission failed", err.cause ?? err);
      throw new SendUnifiedPaymentError(
        "We couldn't submit this payment right now. Please try again in a moment.",
        "PROVIDER_ERROR"
      );
    }
    // Unknown outcome (timeout, network error, process about to die) -
    // leave PENDING, submittedAt set. Same posture as sendPayment() step 7
    // — only lib/circle/reconciliation.ts may resolve this later.
    console.error(
      `[sendUnifiedBalancePayment] CRITICAL: Circle call for OnchainTransaction ${onchainTx.id} ` +
        `(idempotencyKey ${idempotencyKey}) did not complete cleanly - outcome unknown, ` +
        `left PENDING for reconciliation.`,
      err
    );
    throw new SendUnifiedPaymentError(
      "This payment may have been submitted but we couldn't confirm it. Our team has been notified - please don't retry until you hear back.",
      "PROVIDER_ERROR"
    );
  }

  // 7. Mark confirmed, debit the ledger. Wrapped the same way as
  // sendPayment() step 8+ — money has already left custody once we're
  // here, so any failure past this point must surface as a soft
  // PROVIDER_ERROR, never an unhandled 5xx.
  try {
    const confirmedTx = await prisma.onchainTransaction.update({
      where: { id: onchainTx.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        txHash: circleResult.circleTransactionId,
        circleTransactionId: circleResult.circleTransactionId,
      },
    });

    await recordEntry({
      ledgerAccountId: ledgerAccount.id,
      amount: totalCost,
      direction: "DEBIT",
      referenceType: "ONCHAIN_TX",
      referenceId: confirmedTx.id,
    });

    return buildResult(confirmedTx);
  } catch (lateErr) {
    if (lateErr instanceof LedgerInsufficientBalanceError) {
      console.error(
        `[sendUnifiedBalancePayment] CRITICAL: onchainTx ${onchainTx.id} confirmed but ledger debit ` +
          `failed on insufficient balance (race). Manual reconciliation of the LEDGER needed.`,
        lateErr
      );
      throw new SendUnifiedPaymentError(
        "This payment could not be completed due to a balance conflict. Our team has been notified.",
        "INSUFFICIENT_BALANCE"
      );
    }
    console.error(
      `[sendUnifiedBalancePayment] Circle spend resolved (txHash=${circleResult.circleTransactionId}) but a ` +
        `post-submit step failed. Money has ALREADY left the wallet on-chain; DO NOT LET THE CALLER RETRY.`,
      lateErr
    );
    throw new SendUnifiedPaymentError(
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