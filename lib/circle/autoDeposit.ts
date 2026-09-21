// lib/circle/autoDeposit.ts
//
// The piece that makes multi-chain funding actually invisible to users
// (per the redesign this replaces the old manual "Deposit into Unified
// Balance" button/page with): periodically checks each wallet's PLAIN
// USDC balance on Ethereum Sepolia / Base Sepolia / Arbitrum Sepolia,
// deposits any new amount into Circle Gateway's Unified Balance, and
// credits the org's ledger — the same three things a user used to have
// to understand and trigger by hand.
//
// CRITICAL: ARC IS DELIBERATELY NEVER SWEPT HERE. Arc's plain wallet
// balance is what lib/transfers/send.ts#sendPayment (payroll, invoices,
// contacts, every existing internal transfer) spends from directly via
// a normal Arc-native transfer — NOT via Unified Balance. If this sweep
// moved Arc's plain balance into Gateway's contract, it would silently
// starve that entire, already-in-production send path of funds. Arc
// inbound already has its own working pipeline (Circle webhook ->
// lib/transfers/receive.ts, credits the ledger directly) and needs
// nothing from this file. Only the three chains in
// AUTO_DEPOSIT_SOURCE_CHAINS below are swept — funds arriving there have
// no use to Comparta EXCEPT being pulled into Unified Balance, since
// nothing else in this codebase can spend a plain non-Arc balance.
//
// HOW DOUBLE-DEPOSITING IS AVOIDED: WalletChainRegistration.
// cumulativeDepositedAmount tracks the running total already deposited
// FROM each chain. Each sweep only deposits (current plain balance -
// cumulativeDepositedAmount), never the whole balance - so a deposit
// still settling from a prior run, or a chain sitting at a stable
// balance between runs, never gets deposited twice. A dust threshold
// (DUST_THRESHOLD_SMALLEST_UNIT) skips vanishingly small deltas that
// aren't worth an on-chain deposit transaction's gas cost.
//
// LEDGER CREDITING MIRRORS lib/transfers/receive.ts EXACTLY: an
// OnchainTransaction (direction IN) is created PENDING before the
// deposit call, then flipped to CONFIRMED and a LedgerEntry CREDIT is
// recorded against the org's default bucket (resolveDefaultLedgerAccountId
// - same fallback rule as a stray Arc inbound transfer) only after the
// deposit succeeds. A crash between "deposit succeeded" and "DB updated"
// leaves a PENDING OnchainTransaction rather than silently losing the
// credit - the same posture jobs/workers/reconciliation.worker.ts already
// watches for on other PENDING rows.

import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { resolveDefaultLedgerAccountId } from "@/lib/transfers/receive";
import { getUsdcBalance, depositIntoUnifiedBalance, CircleApiError } from "./wallets";
import { toSmallestUnit, toDecimalString } from "./amount";
import type { Chain, Prisma } from "@/app/generated/prisma/client";

/** Never Arc — see module docstring. */
export const AUTO_DEPOSIT_SOURCE_CHAINS: readonly Chain[] = [
  "ETH_SEPOLIA",
  "BASE_SEPOLIA",
  "ARBITRUM_SEPOLIA",
] as const;

/** 0.01 USDC — deltas smaller than this aren't worth an on-chain deposit tx. */
const DUST_THRESHOLD_SMALLEST_UNIT = 10_000n;

export interface AutoDepositSweepResult {
  walletId: string;
  chain: Chain;
  outcome: "deposited" | "skipped-below-dust" | "skipped-no-delta" | "failed";
  delta?: string; // decimal string, only present for "deposited"
  error?: string;
}

/**
 * Runs one sweep across every wallet's registered non-Arc deposit-source
 * chains. Safe to call on a schedule (see jobs/workers/unifiedBalanceDeposit.worker.ts)
 * or on demand - each (wallet, chain) pair is handled independently, so
 * one failure never blocks the rest, and a chain with no registration
 * yet (see lib/circle/wallets.ts#ensureWalletDerivedOnDepositChains) is
 * simply skipped rather than erroring.
 */
export async function runAutoDepositSweep(): Promise<AutoDepositSweepResult[]> {
  const registrations = await prisma.walletChainRegistration.findMany({
    where: { chain: { in: AUTO_DEPOSIT_SOURCE_CHAINS as Chain[] } },
    include: { wallet: true },
  });

  const results: AutoDepositSweepResult[] = [];
  for (const reg of registrations) {
    results.push(await sweepOne(reg));
  }
  return results;
}

async function sweepOne(
  reg: Prisma.WalletChainRegistrationGetPayload<{ include: { wallet: true } }>
): Promise<AutoDepositSweepResult> {
  const { wallet, chain, derivedCircleWalletId, cumulativeDepositedAmount } = reg;

  let plainBalanceDecimal: string;
  try {
    plainBalanceDecimal = await getUsdcBalance(derivedCircleWalletId);
  } catch (err) {
    return {
      walletId: wallet.id,
      chain,
      outcome: "failed",
      error: `Balance check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const plainBalance = toSmallestUnit(plainBalanceDecimal);
  const delta = plainBalance - cumulativeDepositedAmount;

  if (delta <= 0n) {
    return { walletId: wallet.id, chain, outcome: "skipped-no-delta" };
  }
  if (delta < DUST_THRESHOLD_SMALLEST_UNIT) {
    return { walletId: wallet.id, chain, outcome: "skipped-below-dust" };
  }

  // Write-ahead PENDING row before the external deposit call - same
  // "record intent before acting" posture as lib/transfers/send.ts and
  // lib/transfers/sendUnified.ts. counterpartyAddress is "unknown" (same
  // fallback lib/transfers/receive.ts uses) because this sweep detects a
  // balance DELTA, not an individual transfer event - the actual
  // sender(s) on the source chain aren't known here.
  const onchainTx = await prisma.onchainTransaction.create({
    data: {
      walletId: wallet.id,
      direction: "IN",
      amount: delta,
      counterpartyAddress: "unknown",
      chain,
      sourceChain: chain,
      status: "PENDING",
    },
  });

  let depositResult: Awaited<ReturnType<typeof depositIntoUnifiedBalance>>;
  try {
    depositResult = await depositIntoUnifiedBalance(wallet.arcAddress, delta, chain);
  } catch (err) {
    await prisma.onchainTransaction.update({
      where: { id: onchainTx.id },
      data: { status: "FAILED" },
    });
    const message =
      err instanceof CircleApiError ? err.message : err instanceof Error ? err.message : String(err);
    console.error(
      `[autoDeposit] Deposit failed for wallet ${wallet.id} on ${chain} (delta ${toDecimalString(delta)}): ${message}`
    );
    return { walletId: wallet.id, chain, outcome: "failed", error: message };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const confirmedTx = await tx.onchainTransaction.update({
        where: { id: onchainTx.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          txHash: depositResult.txHash,
        },
      });

      const defaultLedgerAccountId = await resolveDefaultLedgerAccountId(tx, wallet.orgId, wallet.id);
      if (!defaultLedgerAccountId) {
        throw new Error(
          `Org ${wallet.orgId} has no default ledger account - cannot credit auto-deposit ${confirmedTx.id}.`
        );
      }

      await recordEntry(
        {
          ledgerAccountId: defaultLedgerAccountId,
          amount: delta,
          direction: "CREDIT",
          referenceType: "ONCHAIN_TX",
          referenceId: confirmedTx.id,
        },
        tx
      );

      await tx.walletChainRegistration.update({
        where: { id: reg.id },
        data: {
          cumulativeDepositedAmount: cumulativeDepositedAmount + delta,
          lastSweptAt: new Date(),
        },
      });
    });
  } catch (err) {
    // The deposit already succeeded on-chain at this point - money has
    // left the plain balance and is sitting in Gateway. A failure here
    // means the ledger credit didn't land; this is exactly the "PENDING
    // row left behind for reconciliation" case the module docstring
    // describes. Do NOT mark it FAILED (it didn't fail - it succeeded
    // and we lost track of bookkeeping), and do NOT retry the deposit
    // itself on the next sweep (cumulativeDepositedAmount wasn't bumped,
    // so the next sweep will compute the same delta again and attempt a
    // SECOND on-chain deposit for money that's already in Gateway).
    // Surface loudly so this gets manual attention rather than silently
    // double-depositing.
    console.error(
      `[autoDeposit] CRITICAL: deposit for wallet ${wallet.id} on ${chain} succeeded on-chain ` +
        `(txHash=${depositResult.txHash}) but crediting the ledger failed. OnchainTransaction ` +
        `${onchainTx.id} is left PENDING. Manual reconciliation needed - do not re-run the sweep ` +
        `for this wallet/chain until this is resolved.`,
      err
    );
    return {
      walletId: wallet.id,
      chain,
      outcome: "failed",
      error: "Deposit succeeded but ledger credit failed - needs manual reconciliation.",
    };
  }

  return { walletId: wallet.id, chain, outcome: "deposited", delta: toDecimalString(delta) };
}
