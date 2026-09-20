// lib/circle/unifiedBalance.ts
//
// Wraps App Kit's Unified Balance capability (kit.unifiedBalance.*), built
// on Circle Gateway. This merges USDC held across several blockchains into
// one chain-agnostic balance for a given address, and lets that balance be
// spent to any supported destination chain without the caller manually
// bridging first.
//
// This is the SECOND (and only other) module allowed to call App Kit
// directly — see lib/circle/appKit.ts's module docstring, which owns Send.
// This module reuses that file's memoized adapter/kit singletons
// (getCircleWalletsAdapter/getAppKit) rather than constructing its own, so
// CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET are still wired into an App Kit
// adapter in exactly one place codebase-wide.
//
// CORRECTNESS NOTE (2026-09-19): every type in this file — GetBalancesParams/
// Result, DepositParams/Result, SpendParams/Result, the UnifiedBalanceChain
// enum — is checked against the ACTUAL installed package
// (node_modules/@circle-fin/app-kit@1.12.0/*.d.ts), not against docs pages.
// An earlier version of this file had two real bugs from relying on docs
// examples instead: (1) it was missing depositToUnifiedBalance() entirely
// (see "THE PART THAT WAS MISSING" below), and (2) spendFromUnifiedBalance()
// passed the recipient as `to.address`, which is actually the destination
// ADAPTER's own account-context field, not who receives the funds — the
// real field for that is `to.recipientAddress`. Both are fixed below.
// Re-check node_modules/@circle-fin/app-kit/*.d.ts (not this comment)
// if App Kit is ever upgraded past 1.12.0, since these shapes are exactly
// the kind of thing that changes between major versions.
//
// THE PART THAT WAS MISSING — READ THIS BEFORE ASSUMING A DEPOSIT "JUST
// SHOWS UP": Unified Balance is NOT "how much USDC sits at this address."
// It's a separate balance tracked inside Circle Gateway's own smart
// contract (GatewayWallet), and nothing counts toward it — confirmed OR
// pending — until an explicit deposit() call moves funds from a plain
// wallet balance into that contract. A wallet holding USDC from an
// ordinary transfer (e.g. Comparta's existing Send, or someone wiring
// USDC to this wallet's address directly on any of the chains below) will
// correctly show $0 in getUnifiedBalance() until depositToUnifiedBalance()
// (below) is called for that chain. This isn't a bug to route around —
// it's how Gateway works — so any UI/flow that wants a deposit to actually
// register needs to trigger a deposit() call, not just wait.
//
// WHICH CHAINS ARE ACTUALLY WIRED HERE, AND WHY (checked against the
// UnifiedBalanceChain enum in the installed package on 2026-09-19 — that
// enum, not the broader Blockchain enum, is Gateway's actual supported-
// chain allowlist): ARC_TESTNET, ETH_SEPOLIA, BASE_SEPOLIA,
// ARBITRUM_SEPOLIA, HYPEREVM_TESTNET are present in UnifiedBalanceChain and
// are the only chains toUnifiedBalanceChain() below will map. Celo and
// Monad Testnet were requested but are intentionally absent from the Chain
// enum itself (see prisma/schema.prisma) rather than kept-and-blocked
// here: neither appears in UnifiedBalanceChain at all (Monad and
// Celo_Alfajores_Testnet exist only in the broader Blockchain enum, which
// covers Send/Bridge/Swap, not Unified Balance). Re-add either only once a
// fresh check of the installed package's UnifiedBalanceChain enum shows it
// listed, updating the Chain enum, UNIFIED_BALANCE_SUPPORTED_CHAINS, and
// toUnifiedBalanceChain() together.
//
// STILL ON TESTNET: networkType is hardcoded to "testnet" in
// getUnifiedBalance, and every chain literal this module maps to is a
// testnet chain. Flip that — and re-verify each chain's MAINNET Unified
// Balance support the same way — before pointing this at production funds.
//
// ADDRESS ASSUMPTION THAT STILL NEEDS A LIVE CHECK: this module does not
// provision any new per-chain wallet record (Wallet.arcAddress /
// createWalletForOrg are untouched). It assumes the org's existing SCA
// wallet address is a valid deposit-source address on every chain listed
// above — standard for how Circle SCA wallets deploy across EVM chains,
// but unconfirmed against a real deposit on any chain but Arc in this
// repo. This is a SEPARATE concern from the deposit() requirement above:
// even with the right address, funds still won't show until deposited.
//
// WHAT THIS MODULE DOES NOT DO: it doesn't watch for incoming transfers
// and auto-deposit them into Gateway (no webhook covers these chains —
// see chainMapping.ts's module docstring), and it doesn't persist any
// balance snapshot. Every call here hits Gateway live, same posture as
// getUsdcBalance() in wallets.ts for the single-chain case. Turning
// "USDC arrived at this address" into "credited to Unified Balance" is
// currently a manual step via depositToUnifiedBalance() — automating that
// (e.g. a poller that detects a plain balance and deposits it) is a
// follow-up, not something this file does today.

import { getAppKit, getCircleWalletsAdapter } from "./appKit";
import { toDecimalString, toSmallestUnit } from "./amount";
import type { Chain } from "@/app/generated/prisma/client";

export class UnifiedBalanceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "UnifiedBalanceError";
  }
}

/** Thrown by toUnifiedBalanceChain() for a Chain we know isn't (or isn't
 * yet confirmed) Unified-Balance-supported — see module docstring. */
export class UnifiedBalanceUnsupportedChainError extends UnifiedBalanceError {}

/**
 * Every Chain value this module will map to an App Kit Unified Balance
 * chain literal. Kept as an explicit allowlist (rather than "anything not
 * in a blocklist") so a future Chain enum addition defaults to unsupported
 * until someone deliberately wires it up here.
 */
export const UNIFIED_BALANCE_SUPPORTED_CHAINS: readonly Chain[] = [
  "ARC_TESTNET",
  "ETH_SEPOLIA",
  "BASE_SEPOLIA",
  "ARBITRUM_SEPOLIA",
  "HYPEREVM_TESTNET",
] as const;

export function isUnifiedBalanceSupported(chain: Chain): boolean {
  return (UNIFIED_BALANCE_SUPPORTED_CHAINS as Chain[]).includes(chain);
}

/**
 * Maps a Comparta Chain to App Kit's Unified Balance chain literal (values
 * of the installed package's UnifiedBalanceChain enum — confirmed exact
 * string match, see module docstring). Throws
 * UnifiedBalanceUnsupportedChainError for anything not in
 * UNIFIED_BALANCE_SUPPORTED_CHAINS.
 */
export function toUnifiedBalanceChain(
  chain: Chain
): "Arc_Testnet" | "Ethereum_Sepolia" | "Base_Sepolia" | "Arbitrum_Sepolia" | "HyperEVM_Testnet" {
  switch (chain) {
    case "ARC_TESTNET":
      return "Arc_Testnet";
    case "ETH_SEPOLIA":
      return "Ethereum_Sepolia";
    case "BASE_SEPOLIA":
      return "Base_Sepolia";
    case "ARBITRUM_SEPOLIA":
      return "Arbitrum_Sepolia";
    case "HYPEREVM_TESTNET":
      return "HyperEVM_Testnet";
    default:
      throw new UnifiedBalanceUnsupportedChainError(
        `No Unified Balance chain literal mapped for Comparta chain "${chain}". Check the ` +
          `installed @circle-fin/app-kit package's UnifiedBalanceChain enum before wiring this in.`
      );
  }
}

export interface UnifiedBalanceChainAmount {
  chain: Chain;
  confirmed: bigint; // smallest USDC unit
  pending: bigint; // smallest USDC unit
}

export interface UnifiedBalanceSnapshot {
  totalConfirmed: bigint;
  totalPending: bigint;
  byChain: UnifiedBalanceChainAmount[];
}

/**
 * Reads the Unified Balance for `address` across every chain in
 * UNIFIED_BALANCE_SUPPORTED_CHAINS, by address (no adapter/signing key
 * needed — this is a read, same posture as getUsdcBalance() in
 * wallets.ts). Chains with zero confirmed/pending balance are still
 * included in `byChain` so the UI can show "$0 on Ethereum Sepolia"
 * rather than omitting the chain entirely.
 *
 * Returns 0 for a chain where funds have merely arrived at `address` but
 * were never deposited into Gateway — see module docstring. That is
 * correct behavior, not a bug in this function.
 */
export async function getUnifiedBalance(address: string): Promise<UnifiedBalanceSnapshot> {
  const kit = getAppKit();
  const chains = UNIFIED_BALANCE_SUPPORTED_CHAINS.map(toUnifiedBalanceChain);

  // Shape confirmed against the installed package's GetBalancesResult /
  // BalanceWithPendingBreakdown / ChainBalanceBreakdown types — not typed
  // against the SDK's own exported types here only because those generics
  // are awkward to import standalone; the field names/nesting are exact.
  type GetBalancesResult = {
    breakdown?: Array<{
      breakdown?: Array<{ chain: string; confirmedBalance?: string; pendingBalance?: string }>;
    }>;
  };

  let result: GetBalancesResult;
  try {
    result = (await kit.unifiedBalance.getBalances({
      sources: { address, chains },
      networkType: "testnet",
      includePending: true,
    })) as GetBalancesResult;
  } catch (err) {
    throw new UnifiedBalanceError(`Failed to read Unified Balance for ${address}`, err);
  }

  // Querying by a single address yields exactly one depositor entry, but
  // this defensively sums over all of them (and de-dupes per chain) rather
  // than assuming breakdown[0].
  const perChainTotals = new Map<Chain, { confirmed: bigint; pending: bigint }>();
  for (const supported of UNIFIED_BALANCE_SUPPORTED_CHAINS) {
    perChainTotals.set(supported, { confirmed: 0n, pending: 0n });
  }

  const CHAIN_LITERAL_TO_INTERNAL: Record<string, Chain> = {
    Arc_Testnet: "ARC_TESTNET",
    Ethereum_Sepolia: "ETH_SEPOLIA",
    Base_Sepolia: "BASE_SEPOLIA",
    Arbitrum_Sepolia: "ARBITRUM_SEPOLIA",
    HyperEVM_Testnet: "HYPEREVM_TESTNET",
  };

  const breakdown = result.breakdown ?? [];

  for (const depositor of breakdown) {
    for (const entry of depositor.breakdown ?? []) {
      const internalChain = CHAIN_LITERAL_TO_INTERNAL[entry.chain];
      if (!internalChain) continue; // chain we didn't ask about — ignore rather than guess
      const totals = perChainTotals.get(internalChain) ?? { confirmed: 0n, pending: 0n };
      totals.confirmed += toSmallestUnit(entry.confirmedBalance ?? "0");
      totals.pending += toSmallestUnit(entry.pendingBalance ?? "0");
      perChainTotals.set(internalChain, totals);
    }
  }

  const byChain: UnifiedBalanceChainAmount[] = UNIFIED_BALANCE_SUPPORTED_CHAINS.map((chain) => {
    const totals = perChainTotals.get(chain) ?? { confirmed: 0n, pending: 0n };
    return { chain, confirmed: totals.confirmed, pending: totals.pending };
  });

  const totalConfirmed = byChain.reduce((sum, c) => sum + c.confirmed, 0n);
  const totalPending = byChain.reduce((sum, c) => sum + c.pending, 0n);

  return { totalConfirmed, totalPending, byChain };
}

export interface UnifiedBalanceDepositResult {
  depositedTo: string;
  depositedBy: string;
  txHash: string;
  explorerUrl?: string;
}

/**
 * Moves `amount` (bigint, smallest USDC unit) already sitting as a plain
 * balance at `address` on `sourceChain` INTO Circle Gateway's Unified
 * Balance — the step described in the module docstring that was missing
 * before. Until this is called for a given chain's funds, those funds
 * will never appear in getUnifiedBalance()'s output, no matter how long
 * you wait.
 *
 * Uses `allowanceStrategy: 'authorize'` (EIP-3009 transferWithAuthorization)
 * rather than a separate approve() transaction first — USDC supports this,
 * and it's App Kit's own default. Requires the source chain to have
 * enough native gas token for this on-chain call to actually submit;
 * Comparta doesn't currently check that before calling this.
 */
export async function depositToUnifiedBalance(
  address: string,
  amount: bigint,
  sourceChain: Chain
): Promise<UnifiedBalanceDepositResult> {
  if (amount <= 0n) {
    throw new UnifiedBalanceError("depositToUnifiedBalance: amount must be positive");
  }

  const kit = getAppKit();
  const adapter = getCircleWalletsAdapter();
  const chain = toUnifiedBalanceChain(sourceChain); // throws for unsupported chains

  try {
    const result = await kit.unifiedBalance.deposit({
      from: { adapter, chain, address },
      amount: toDecimalString(amount),
      allowanceStrategy: "authorize",
    });
    return {
      depositedTo: result.depositedTo,
      depositedBy: result.depositedBy,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
    };
  } catch (err) {
    if (err instanceof UnifiedBalanceError) throw err;
    throw new UnifiedBalanceError(
      `Failed to deposit ${toDecimalString(amount)} USDC into Unified Balance from ${address} ` +
        `on ${sourceChain}`,
      err
    );
  }
}

export interface UnifiedBalanceSpendResult {
  txHash: string;
  state: string;
  explorerUrl?: string;
}

/**
 * Spends `amount` (bigint, smallest USDC unit) from the Unified Balance
 * at `fromAddress`, delivered to `toAddress` on `destinationChain`.
 *
 * Uses the Forwarding Service (`useForwarder: true`) so the recipient can
 * be an arbitrary external address — Comparta does not need a custody
 * adapter on the destination chain.
 *
 * Preflights with `estimateSpend()` so we surface fee shortfalls (especially
 * the Gateway forwarding fee) before signing burn intents. Gateway requires:
 *   maxFee ≥ gas fee + forwarding fee + (amount * 0.5bps)
 * Spending the full confirmed balance with no buffer is a common cause of:
 *   "Insufficient total maxFee across intents to cover forwarding fee"
 */
export async function spendFromUnifiedBalance(
  fromAddress: string,
  toAddress: string,
  amount: bigint,
  destinationChain: Chain
): Promise<UnifiedBalanceSpendResult> {
  if (amount <= 0n) {
    throw new UnifiedBalanceError("spendFromUnifiedBalance: amount must be positive");
  }

  const kit = getAppKit();
  const adapter = getCircleWalletsAdapter();
  const chain = toUnifiedBalanceChain(destinationChain); // throws for unsupported chains

  const spendParams = {
    amount: toDecimalString(amount),
    from: { adapter, address: fromAddress },
    to: {
      chain,
      recipientAddress: toAddress,
      useForwarder: true as const,
    },
  };

  try {
    // ── Preflight: same route shape as spend, so fee estimate matches ──
    type FeeEntry = { type?: string; amount?: string; token?: string };
    type EstimateSpendResult = { fees?: FeeEntry[] };

    let estimate: EstimateSpendResult;
    try {
      estimate = (await kit.unifiedBalance.estimateSpend(
        spendParams
      )) as EstimateSpendResult;
    } catch (estimateErr) {
      // If estimate itself fails (e.g. balance too low for amount+fees),
      // surface that rather than a opaque spend failure later.
      throw new UnifiedBalanceError(
        `Unified Balance fee estimate failed for ${toDecimalString(amount)} USDC ` +
          `→ ${destinationChain}. Confirmed balance may be too low to cover amount + ` +
          `gas + forwarding fees. Try a smaller amount or leave ~0.05–0.10 USDC buffer.`,
        estimateErr
      );
    }

    const fees = estimate.fees ?? [];
    const feeTotal = fees.reduce(
      (sum, f) => sum + toSmallestUnit(f.amount ?? "0"),
      0n
    );

    const forwarderFee = fees.find((f) => f.type === "forwarder");
    const gasFee = fees.find((f) => f.type === "gasFee");
    const providerFee = fees.find((f) => f.type === "provider");

    console.info("[unifiedBalance.spend] fee estimate", {
      amount: toDecimalString(amount),
      destinationChain,
      feeTotal: toDecimalString(feeTotal),
      forwarder: forwarderFee?.amount ?? "0",
      gasFee: gasFee?.amount ?? "0",
      provider: providerFee?.amount ?? "0",
    });

    // ── Execute spend with the same params ──
    const result = (await kit.unifiedBalance.spend(spendParams)) as {
      txHash?: string;
      state?: string;
      explorerUrl?: string;
      fees?: FeeEntry[];
      transferId?: string;
    };

    if (!result?.txHash) {
      throw new UnifiedBalanceError(
        "App Kit unifiedBalance.spend() returned no txHash"
      );
    }

    return {
      txHash: result.txHash,
      state: result.state ?? "success",
      explorerUrl: result.explorerUrl,
    };
  } catch (err) {
    if (err instanceof UnifiedBalanceError) throw err;

    // Map the common Gateway maxFee / forwarder shortfall to a clear message.
    const msg =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message)
        : String(err);
    const causeMsg =
      err &&
      typeof err === "object" &&
      "cause" in err &&
      (err as { cause?: unknown }).cause
        ? String((err as { cause: unknown }).cause)
        : "";

    if (
      /Insufficient total maxFee|forwarding fee|maxFee/i.test(msg) ||
      /Insufficient total maxFee|forwarding fee|maxFee/i.test(causeMsg)
    ) {
      throw new UnifiedBalanceError(
        `Unified Balance spend of ${toDecimalString(amount)} USDC to ${toAddress} on ` +
          `${destinationChain} failed: Gateway forwarding/gas fees exceed the maxFee ` +
          `reserved on the burn intents. Leave a buffer (try a slightly smaller amount; ` +
          `~0.05–0.10 USDC is often enough on testnet) so amount + fees fit in confirmed balance.`,
        err
      );
    }

    throw new UnifiedBalanceError(
      `Unified Balance spend of ${toDecimalString(amount)} USDC from ${fromAddress} to ` +
        `${toAddress} on ${destinationChain} failed`,
      err
    );
  }
}