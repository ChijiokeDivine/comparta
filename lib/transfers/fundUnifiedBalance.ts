// lib/transfers/fundUnifiedBalance.ts
//
// Hybrid model C — explicit Fund Unified Balance:
//   1. User selects bucket allocations (sum = deposit amount).
//   2. Validate each bucket balance + Arc plain onchain >= amount.
//   3. Move Arc plain USDC → Circle Gateway (deposit).
//   4. On success, DEBIT the selected buckets (ledger leaves with the money).
//
// Unified Balance is intentionally OUTSIDE the ledger. After this call:
//   Σ ledger decreases by `amount`
//   Arc onchain decreases by `amount`
//   Unified Balance increases by ~amount (pending → confirmed)
// so Σ ledger stays aligned with Arc onchain (modulo fees/gas edge cases).

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { recordEntry, getBalance, InsufficientBalanceError } from "@/lib/ledger/engine";
import { depositIntoUnifiedBalance, getUsdcBalance, CircleApiError } from "@/lib/circle/wallets";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";
import { isDepositSourceSupported } from "@/lib/circle/unifiedBalance";
import type { Chain } from "@/app/generated/prisma/client";

export class FundUnifiedError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_AMOUNT"
      | "INVALID_ALLOCATION"
      | "INSUFFICIENT_LEDGER"
      | "INSUFFICIENT_ONCHAIN"
      | "UNSUPPORTED_CHAIN"
      | "NO_WALLET"
      | "PROVIDER_ERROR"
  ) {
    super(message);
    this.name = "FundUnifiedError";
  }
}

export interface BucketAllocationInput {
  ledgerAccountId: string;
  /** Decimal string, e.g. "20.00" */
  amount: string;
}

export interface FundUnifiedBalanceInput {
  orgId: string;
  sourceChain: Chain;
  /** Total to deposit — must equal sum of allocations. */
  amount: string;
  allocations: BucketAllocationInput[];
  idempotencyKey?: string;
}

export interface FundUnifiedBalanceResult {
  deposit: {
    depositedTo: string;
    txHash: string;
    explorerUrl?: string;
  };
  debited: { ledgerAccountId: string; amount: string }[];
}

export async function fundUnifiedBalance(
  input: FundUnifiedBalanceInput
): Promise<FundUnifiedBalanceResult> {
  if (!isDepositSourceSupported(input.sourceChain)) {
    throw new FundUnifiedError(
      `"${input.sourceChain}" is not supported as a deposit source.`,
      "UNSUPPORTED_CHAIN"
    );
  }

  let total: bigint;
  try {
    total = toSmallestUnit(input.amount);
  } catch {
    throw new FundUnifiedError(`"${input.amount}" isn't a valid USDC amount.`, "INVALID_AMOUNT");
  }
  if (total <= 0n) {
    throw new FundUnifiedError("Amount must be greater than zero.", "INVALID_AMOUNT");
  }
  if (!input.allocations.length) {
    throw new FundUnifiedError("Select at least one bucket to debit.", "INVALID_ALLOCATION");
  }

  const parsedAllocs: { ledgerAccountId: string; amount: bigint }[] = [];
  let allocSum = 0n;
  const seen = new Set<string>();
  for (const a of input.allocations) {
    if (seen.has(a.ledgerAccountId)) {
      throw new FundUnifiedError("Duplicate bucket in allocations.", "INVALID_ALLOCATION");
    }
    seen.add(a.ledgerAccountId);
    let amt: bigint;
    try {
      amt = toSmallestUnit(a.amount);
    } catch {
      throw new FundUnifiedError(`Invalid allocation amount "${a.amount}".`, "INVALID_AMOUNT");
    }
    if (amt <= 0n) {
      throw new FundUnifiedError("Each allocation must be greater than zero.", "INVALID_AMOUNT");
    }
    allocSum += amt;
    parsedAllocs.push({ ledgerAccountId: a.ledgerAccountId, amount: amt });
  }
  if (allocSum !== total) {
    throw new FundUnifiedError(
      `Allocations sum to ${toDecimalString(allocSum)} USDC but deposit amount is ${toDecimalString(total)} USDC.`,
      "INVALID_ALLOCATION"
    );
  }

  const wallet = await prisma.wallet.findFirst({ where: { orgId: input.orgId } });
  if (!wallet) {
    throw new FundUnifiedError("No wallet provisioned for this organization.", "NO_WALLET");
  }

  // Validate every bucket belongs to this org and has enough balance.
  for (const a of parsedAllocs) {
    const account = await prisma.ledgerAccount.findFirst({
      where: { id: a.ledgerAccountId, orgId: input.orgId, archived: false },
    });
    if (!account) {
      throw new FundUnifiedError(
        `Bucket ${a.ledgerAccountId} not found.`,
        "INVALID_ALLOCATION"
      );
    }
    const bal = await getBalance(a.ledgerAccountId);
    if (bal < a.amount) {
      throw new FundUnifiedError(
        `Insufficient balance in bucket: need ${toDecimalString(a.amount)} USDC, have ${toDecimalString(bal)}.`,
        "INSUFFICIENT_LEDGER"
      );
    }
  }

  // Arc plain onchain must cover the deposit (source is typically ARC_TESTNET).
  if (input.sourceChain === "ARC_TESTNET" || input.sourceChain === wallet.chain) {
    try {
      const onchainStr = await getUsdcBalance(wallet.circleWalletId);
      const onchain = toSmallestUnit(onchainStr);
      if (onchain < total) {
        throw new FundUnifiedError(
          `Insufficient onchain USDC: need ${toDecimalString(total)}, have ${onchainStr}.`,
          "INSUFFICIENT_ONCHAIN"
        );
      }
    } catch (err) {
      if (err instanceof FundUnifiedError) throw err;
      // If balance read fails, let the deposit attempt surface the real error.
      console.warn("[fundUnifiedBalance] onchain balance pre-check failed", err);
    }
  }

  const idem = input.idempotencyKey ?? randomUUID();

  let depositResult: { depositedTo: string; txHash: string; explorerUrl?: string };
  try {
    depositResult = await depositIntoUnifiedBalance(wallet.arcAddress, total, input.sourceChain);
  } catch (err) {
    if (err instanceof CircleApiError) {
      throw new FundUnifiedError(err.message, "PROVIDER_ERROR");
    }
    throw new FundUnifiedError(
      err instanceof Error ? err.message : "Deposit failed",
      "PROVIDER_ERROR"
    );
  }

  // Ledger debits only after onchain deposit succeeded. referenceId is stable
  // per bucket so retries of recordEntry are idempotent.
  const debited: { ledgerAccountId: string; amount: string }[] = [];
  for (const a of parsedAllocs) {
    try {
      await recordEntry({
        ledgerAccountId: a.ledgerAccountId,
        amount: a.amount,
        direction: "DEBIT",
        referenceType: "ADJUSTMENT",
        referenceId: `ub-deposit:${depositResult.txHash}:${a.ledgerAccountId}`,
      });
      debited.push({
        ledgerAccountId: a.ledgerAccountId,
        amount: toDecimalString(a.amount),
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        console.error(
          `[fundUnifiedBalance] CRITICAL: deposit ${depositResult.txHash} succeeded but ledger debit failed for ${a.ledgerAccountId}`,
          err
        );
        throw new FundUnifiedError(
          "Deposit succeeded on-chain but updating bucket balances failed. Support has been notified — do not retry the same deposit.",
          "PROVIDER_ERROR"
        );
      }
      throw err;
    }
  }

  return { deposit: depositResult, debited };
}
