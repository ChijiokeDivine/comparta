// lib/circle/reconciliation.ts
//
// Resolves OnchainTransaction rows stuck in status=PENDING with
// submittedAt set - i.e. lib/transfers/send.ts called kit.send() and then
// lost track of the outcome before it could write CONFIRMED (crash,
// timeout, deploy mid-request).
//
// App Kit itself gives no way to look this up after the fact (see
// lib/circle/appKit.ts's module docstring - no pending id, no documented
// getTransaction equivalent). But App Kit's Circle-Wallets adapter
// executes through the SAME Developer-Controlled Wallets custody as
// lib/circle/client.ts's raw SDK client (same API key / entity secret) -
// so the raw client's transaction listing endpoint can still find it.
//
// VERIFY BEFORE TRUSTING IN PROD: this assumes
//   - Wallet.circleWalletId exists in the schema
//   - client.listTransactions({ walletIds, blockchain, from, to }) matches
//     Circle's documented List Transactions endpoint shape for your
//     installed SDK version
// Check both against your actual schema.prisma / node_modules types.

import { getCircleClient } from "./client";
import { prisma } from "@/lib/db/prisma";
import { recordEntry, InsufficientBalanceError as LedgerInsufficientBalanceError } from "@/lib/ledger/engine";
import { handlePayrollTransactionResolved } from "@/lib/payroll/completion";
import type { OnchainTransaction, Wallet } from "@/app/generated/prisma/client";

// Give kit.send() + our own CONFIRMED write time to land normally before
// treating a row as stuck - avoids racing a request that's simply slow.
const STUCK_AFTER_MS = 2 * 60 * 1000;

// After this long with no matching Circle transaction found, stop
// auto-retrying the lookup and escalate to a human instead of leaving it
// silently PENDING forever. Deliberately does NOT auto-mark FAILED - see
// escalate() below for why.
const ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;

type StuckTx = OnchainTransaction & { wallet: Wallet };

export async function reconcilePendingSends(): Promise<void> {
  const stuck = await prisma.onchainTransaction.findMany({
    where: {
      status: "PENDING",
      direction: "OUT",
      submittedAt: { not: null, lte: new Date(Date.now() - STUCK_AFTER_MS) },
    },
    include: { wallet: true },
  });

  for (const tx of stuck as StuckTx[]) {
    try {
      await reconcileOne(tx);
    } catch (err) {
      console.error(`[reconcilePendingSends] failed for onchainTx ${tx.id}`, err);
    }
  }
}

async function reconcileOne(tx: StuckTx): Promise<void> {
  const client = getCircleClient();

  const res = await client.listTransactions({
    walletIds: [tx.wallet.circleWalletId],
    blockchain: tx.wallet.chain === "ARC_MAINNET" ? "ARC" : "ARC-TESTNET",
    txType: "OUTBOUND",
    destinationAddress: tx.counterpartyAddress,
    from: tx.submittedAt!.toISOString(),
    to: new Date().toISOString(),
  });

  const candidates = res.data?.transactions ?? [];
  // destinationAddress + txType + time window are already server-filtered -
  // amount is the only thing left to disambiguate multiple sends to the
  // same recipient in the same window (e.g. two payroll items to the
  // same contractor).
  const match = candidates.find((t: { amounts?: string[] }) => matchesAmount(t.amounts, tx.amount));

  if (match) {
    await confirmFromMatch(tx, match as { id?: string; txHash?: string });
    return;
  }

  if (Date.now() - tx.submittedAt!.getTime() > ESCALATE_AFTER_MS) {
    await escalate(tx);
  }
}

function matchesAmount(circleAmounts: string[] | undefined, expectedSmallestUnit: bigint): boolean {
  if (!circleAmounts?.length) return false;
  return circleAmounts.some((a) => {
    try {
      // USDC = 6 decimals. Parsed from Circle's decimal-string amount -
      // fine for matching (not for storing; we store their id/txHash below).
      return BigInt(Math.round(parseFloat(a) * 1_000_000)) === expectedSmallestUnit;
    } catch {
      return false;
    }
  });
}

async function confirmFromMatch(
  tx: StuckTx,
  match: { id?: string; txHash?: string }
): Promise<void> {
  // Conditional update, not a blind one - if a concurrent sweep or a
  // late-arriving webhook already resolved this row, don't clobber it.
  const claim = await prisma.onchainTransaction.updateMany({
    where: { id: tx.id, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      txHash: match.txHash ?? tx.txHash,
      circleTransactionId: match.id ?? match.txHash ?? tx.circleTransactionId,
    },
  });
  if (claim.count === 0) return; // already resolved elsewhere

  const confirmedTx = await prisma.onchainTransaction.findUniqueOrThrow({ where: { id: tx.id } });

  if (!tx.fromLedgerAccountId) {
    console.error(
      `[reconciliation] CONFIRMED onchainTx ${tx.id} via reconciliation but has no ` +
        `fromLedgerAccountId - cannot debit the ledger automatically. This means the row predates ` +
        `the fromLedgerAccountId column, or was created outside sendPayment(). Needs manual debit.`
    );
    return;
  }

  try {
    // Idempotent per the LedgerEntry unique constraint - safe even if
    // send.ts's own step 9 also ran (e.g. it actually succeeded and only
    // the response to the caller was lost).
    await recordEntry({
      ledgerAccountId: tx.fromLedgerAccountId,
      amount: tx.amount,
      direction: "DEBIT",
      referenceType: "ONCHAIN_TX",
      referenceId: confirmedTx.id,
    });
  } catch (err) {
    if (err instanceof LedgerInsufficientBalanceError) {
      console.error(
        `[reconciliation] CRITICAL: onchainTx ${confirmedTx.id} confirmed via reconciliation but ` +
          `ledger debit failed on insufficient balance. Manual ledger reconciliation needed.`,
        err
      );
      return;
    }
    throw err;
  }

  await handlePayrollTransactionResolved(confirmedTx).catch((err) =>
    console.error(`[reconciliation] payroll completion hook failed for onchainTx ${confirmedTx.id}`, err)
  );
}

/**
 * No matching Circle transaction after 24h. This is deliberately NOT
 * "mark FAILED and move on" - unlike the old REST flow (where a genuinely
 * failed Circle transaction has a terminal state we can trust),
 * listTransactions coming back empty is ambiguous: it could mean the send
 * never reached Circle, OR it could mean our filter/window/field-mapping
 * is wrong and the funds DID move. Auto-crediting back a debit that
 * actually succeeded on-chain would be a worse bug than the one we're
 * fixing. This just makes the situation loud instead of silent.
 */
async function escalate(tx: StuckTx): Promise<void> {
  console.error(
    `[reconciliation] CRITICAL: no matching Circle transaction found for onchainTx ${tx.id} ` +
      `(idempotencyKey ${tx.idempotencyKey}, wallet ${tx.wallet.circleWalletId}, ` +
      `amount ${tx.amount}, to ${tx.counterpartyAddress}) after 24h. Requires manual lookup in the ` +
      `Circle console before this row is touched further.`
  );
}