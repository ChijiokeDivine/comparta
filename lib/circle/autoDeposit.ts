// lib/circle/autoDeposit.ts
//
// Two related but distinct mechanisms live here — worth being precise
// about which is which, since conflating them was exactly the gap that
// led to a confusing "insufficient balance" surprise during testing:
//
//   1. runAutoDepositSweep() — a PERIODIC background sweep (see
//      jobs/workers/unifiedBalanceDeposit.worker.ts) that runs on its own
//      schedule, independent of any user action. It only ever touches the
//      three non-Arc chains in AUTO_DEPOSIT_SOURCE_CHAINS.
//
//   2. ensureUnifiedBalanceCovers() — an ON-DEMAND, per-send top-up called
//      from lib/transfers/sendUnified.ts right before a cross-chain spend.
//      If Gateway's confirmed Unified Balance doesn't yet cover the
//      amount being sent, this deposits exactly enough to cover THIS
//      send - first from Arc's plain balance, then (if still short) from
//      whatever undeposited amount sits on the other chains - so the
//      user never has to separately "remember to deposit" before
//      sending. This is what actually delivers "deposit happens
//      invisibly when the user wants to send," which the periodic sweep
//      alone does NOT provide (it only catches funds already sitting
//      idle by the time it happens to run next).
//
// CRITICAL: ARC IS NEVER TOUCHED BY THE PERIODIC SWEEP, but Arc IS a
// valid source for the ON-DEMAND top-up. These aren't contradictory -
// they're different concerns:
//   - The periodic sweep runs UNPROMPTED and would have no way to know
//     how much of Arc's balance is "spare" vs. earmarked for payroll/
//     invoices/contacts (lib/transfers/send.ts#sendPayment spends Arc's
//     plain balance directly) - sweeping all of it into Gateway on a
//     timer would silently starve that flow.
//   - The on-demand top-up is different: it moves ONLY the amount a
//     specific, user-initiated send actually needs, at the moment it's
//     needed. Moving that money is exactly what the user asked for by
//     initiating the send - it's bounded and intentional, not a
//     background process helping itself to the treasury.
//   - Moving Arc's OWN money into Gateway is also ledger-NEUTRAL: that
//     money was already credited to the org's ledger when it arrived on
//     Arc (lib/transfers/receive.ts). Relocating it into Gateway's
//     contract doesn't change how much the org owns, so
//     ensureUnifiedBalanceCovers() does NOT record any ledger entry for
//     the Arc portion - only for genuinely new money pulled in from the
//     three non-Arc chains, which was never ledger-credited until now.
//
// HOW DOUBLE-DEPOSITING IS AVOIDED: WalletChainRegistration.
// cumulativeDepositedAmount tracks the running total already deposited
// FROM each non-Arc chain. Both the sweep and the on-demand path only
// ever deposit (current plain balance - cumulativeDepositedAmount) for
// those chains, so whichever one gets there first for a given chain
// leaves nothing for the other to double-count. A dust threshold
// (DUST_THRESHOLD_SMALLEST_UNIT) skips vanishingly small deltas that
// aren't worth an on-chain deposit transaction's gas cost.
//
// LEDGER CREDITING (non-Arc chains only) MIRRORS lib/transfers/receive.ts
// EXACTLY: an OnchainTransaction (direction IN) is created PENDING before
// the deposit call, then flipped to CONFIRMED and a LedgerEntry CREDIT is
// recorded against the org's default bucket (resolveDefaultLedgerAccountId
// - same fallback rule as a stray Arc inbound transfer) only after the
// deposit succeeds. A crash between "deposit succeeded" and "DB updated"
// leaves a PENDING OnchainTransaction rather than silently losing the
// credit - the same posture jobs/workers/reconciliation.worker.ts already
// watches for on other PENDING rows.

import { prisma } from "@/lib/db/prisma";
import { recordEntry } from "@/lib/ledger/engine";
import { resolveDefaultLedgerAccountId } from "@/lib/transfers/receive";
import { getUsdcBalance, depositIntoUnifiedBalance, getUnifiedUsdcBalance, CircleApiError } from "./wallets";
import { waitForConfirmedBalance } from "./unifiedBalance";
import { toSmallestUnit, toDecimalString } from "./amount";
import type { Chain, Prisma, Wallet } from "@/app/generated/prisma/client";

/** Never touched by the PERIODIC sweep — see module docstring. Arc IS a
 * valid source for ensureUnifiedBalanceCovers()'s on-demand top-up. */
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
    results.push(await depositRegistrationDelta(reg));
  }
  return results;
}

export interface EnsureCoverageResult {
  covered: boolean;
  /** Total newly deposited into Gateway across every source used, decimal string. */
  totalDeposited: string;
  /** Only non-empty if `covered` is false after trying everything available. */
  shortfall?: string;
}

/**
 * Called from lib/transfers/sendUnified.ts right before a cross-chain
 * spend. Ensures the wallet's confirmed Unified Balance covers
 * `amountNeeded` (smallest USDC unit), depositing just enough to close
 * the gap if it doesn't - Arc's plain balance first, then the non-Arc
 * chains' undeposited deltas - so a user initiating a send never has to
 * separately "deposit into Unified Balance" first. See module docstring
 * for why Arc is fair game here but not for the periodic sweep.
 *
 * After depositing, this WAITS (via waitForConfirmedBalance) until
 * Gateway actually reports the target as confirmed before returning -
 * a deposit call resolving does not mean it's immediately spendable
 * (Circle's own confirmed-vs-pending distinction applies even to Arc's
 * fast finality; there is still a real, if usually short, attestation
 * delay). Skipping this wait is exactly what caused an "insufficient
 * balance" error from Circle immediately after a top-up that had, from
 * this codebase's point of view, already "succeeded."
 *
 * Returns `covered: false` (never throws) if even every available source
 * combined isn't enough, OR if funds were deposited but didn't confirm
 * within the wait window - the caller decides how to surface either
 * case. This function only ever tops up; it never partially executes
 * the send.
 */
export async function ensureUnifiedBalanceCovers(
  wallet: Wallet,
  amountNeeded: bigint
): Promise<EnsureCoverageResult> {
  let totalDeposited = 0n;

  const snapshot = await getUnifiedUsdcBalance(wallet.arcAddress);
  let shortfall = amountNeeded - snapshot.totalConfirmed;
  if (shortfall <= 0n) {
    return { covered: true, totalDeposited: "0" };
  }

  // 1. Arc's plain balance first — ledger-neutral (see module docstring),
  // and the most likely place an org's money actually sits.
  try {
    const arcPlainDecimal = await getUsdcBalance(wallet.circleWalletId);
    const arcPlain = toSmallestUnit(arcPlainDecimal);
    if (arcPlain > 0n) {
      const arcDeposit = arcPlain < shortfall ? arcPlain : shortfall;
      if (arcDeposit > 0n) {
        await depositIntoUnifiedBalance(wallet.arcAddress, arcDeposit, "ARC_TESTNET");
        totalDeposited += arcDeposit;
        shortfall -= arcDeposit;
      }
    }
  } catch (err) {
    // Not fatal here - fall through and try the other chains; the
    // eventual spend() call (or the shortfall check below) surfaces the
    // real "still not enough" outcome if nothing else covers it either.
    console.error(`[autoDeposit] On-demand Arc top-up failed for wallet ${wallet.id}`, err);
  }

  // 2. Still short? Pull in whatever undeposited amount sits on the
  // non-Arc chains, same delta+ledger-credit logic the periodic sweep
  // uses (this money HASN'T been ledger-credited yet, unlike Arc's).
  if (shortfall > 0n) {
    const registrations = await prisma.walletChainRegistration.findMany({
      where: { walletId: wallet.id, chain: { in: AUTO_DEPOSIT_SOURCE_CHAINS as Chain[] } },
    });

    for (const reg of registrations) {
      if (shortfall <= 0n) break;
      const result = await depositRegistrationDelta({ ...reg, wallet });
      if (result.outcome === "deposited" && result.delta) {
        const deposited = toSmallestUnit(result.delta);
        totalDeposited += deposited;
        shortfall -= deposited;
      }
    }
  }

  if (shortfall > 0n) {
    // Nothing available anywhere covers the rest - no point waiting for
    // a confirmation that isn't coming.
    return { covered: false, totalDeposited: toDecimalString(totalDeposited), shortfall: toDecimalString(shortfall) };
  }

  if (totalDeposited === 0n) {
    // Coverage already existed before this call did anything - no new
    // deposit to wait on.
    return { covered: true, totalDeposited: "0" };
  }

  // A deposit was just submitted above - Gateway needs a moment to
  // confirm it before spend() will see it as spendable. See this
  // function's docstring for why this wait isn't optional.
  const finalSnapshot = await waitForConfirmedBalance(wallet.arcAddress, amountNeeded);
  if (finalSnapshot.totalConfirmed < amountNeeded) {
    const stillShort = amountNeeded - finalSnapshot.totalConfirmed;
    console.error(
      `[autoDeposit] Deposited ${toDecimalString(totalDeposited)} USDC for wallet ${wallet.id} but ` +
        `Gateway still hadn't confirmed enough after the wait window - short by ` +
        `${toDecimalString(stillShort)} USDC. The deposit(s) are real and should confirm soon; this ` +
        `send just couldn't wait for it.`
    );
    return {
      covered: false,
      totalDeposited: toDecimalString(totalDeposited),
      shortfall: toDecimalString(stillShort),
    };
  }

  return { covered: true, totalDeposited: toDecimalString(totalDeposited) };
}

/**
 * Deposits whatever undeposited plain-balance delta exists for ONE
 * (wallet, chain) registration and credits the ledger - the unit of work
 * shared by both runAutoDepositSweep() (loops over every registration)
 * and ensureUnifiedBalanceCovers() (calls this for one wallet's
 * registrations on demand). Exported for that reuse.
 */
export async function depositRegistrationDelta(
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
  // fallback lib/transfers/receive.ts uses) because this detects a
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