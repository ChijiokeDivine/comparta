// lib/circle/unifiedBalance.ts
//
// Wraps App Kit's Unified Balance capability (kit.unifiedBalance.*), built
// on Circle Gateway. This merges USDC held across several blockchains into
// one chain-agnostic balance for a given address, and lets that balance be
// spent to any supported destination chain without the caller manually
// bridging first.
//
// This is the SECOND (and only other) module allowed to call App Kit
// directly - see lib/circle/appKit.ts's module docstring, which owns Send.
// This module reuses that file's memoized adapter/kit singletons
// (getCircleWalletsAdapter/getAppKit) rather than constructing its own, so
// CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET are still wired into an App Kit
// adapter in exactly one place codebase-wide.
//
// WHICH CHAINS ARE ACTUALLY WIRED HERE, AND WHY (checked against
// docs.arc.io/app-kit/references/supported-blockchains on 2026-09-18 -
// re-check before trusting this list if it's been a while): ARC_TESTNET,
// ETH_SEPOLIA, BASE_SEPOLIA, ARBITRUM_SEPOLIA, HYPEREVM_TESTNET -
// confirmed "Unified Balance: yes" on that page, and the only chains
// toUnifiedBalanceChain() below will map. Celo and Monad Testnet were
// requested but are intentionally absent from the Chain enum itself
// (see prisma/schema.prisma) rather than kept-and-blocked here: Celo
// doesn't appear in App Kit's/Gateway's supported-blockchains docs at
// all, and Monad Testnet has Send/Bridge/Swap on App Kit but Circle
// Gateway does not support Unified Balance there yet. Per
// lib/circle/appKit.ts's precedent for ARC_MAINNET: guessing a chain
// literal Circle hasn't documented as Unified-Balance-supported is worse
// than failing loudly, especially for something that moves real USDC -
// so re-add either only once Circle's docs confirm support, updating the
// Chain enum, UNIFIED_BALANCE_SUPPORTED_CHAINS, and
// toUnifiedBalanceChain() together.
//
// STILL ON TESTNET: networkType is hardcoded to "testnet" below
// (getUnifiedBalance) and every chain literal this module maps to is a
// testnet chain. Flip that - and re-verify each chain's MAINNET Unified
// Balance support against the same docs page - before pointing this at
// production funds.
//
// ADDRESS ASSUMPTION THAT NEEDS A LIVE-TESTNET CHECK BEFORE THIS IS
// TRUSTED IN PRODUCTION: this module deliberately does NOT provision any
// new per-chain wallet record (Wallet.arcAddress / createWalletForOrg are
// untouched). It assumes the org's existing SCA wallet address is valid
// as a deposit/spend address on every chain listed above - true for how
// Circle SCA wallets are deterministically deployed across EVM chains,
// per Circle's docs, but this repo has not yet confirmed it against a
// real cross-chain deposit landing on a Comparta-custodied address. Send
// a small testnet deposit on each new chain and confirm it shows up via
// getUnifiedBalance() below before relying on this for real payroll/
// invoice funds.
//
// WHAT THIS MODULE DOES NOT DO: it doesn't listen for deposits (no
// webhook - see chainMapping.ts's module docstring for why Circle's
// existing webhook system doesn't cover these chains) and it doesn't
// persist any balance snapshot. Every call here hits Gateway live, same
// posture as getUsdcBalance() in wallets.ts for the single-chain case.

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
 * yet confirmed) Unified-Balance-supported - see module docstring. */
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
 * Maps a Comparta Chain to App Kit's Unified Balance chain literal.
 * Throws UnifiedBalanceUnsupportedChainError for anything not in
 * UNIFIED_BALANCE_SUPPORTED_CHAINS. In practice this should only ever hit
 * the `default` case today, since Celo/Monad Testnet were kept out of the
 * Chain enum entirely rather than passed through and blocked here - see
 * module docstring - but this stays defensive in case the enum grows
 * again before this function does.
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
        `No Unified Balance chain literal mapped for Comparta chain "${chain}". Checked ` +
          `docs.arc.io/app-kit/references/supported-blockchains on 2026-09-18 - re-check there ` +
          `before wiring this chain in.`
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
 * needed - this is a read, same posture as getUsdcBalance() in
 * wallets.ts). Chains with zero confirmed/pending balance are still
 * included in `byChain` so the UI can show "$0 on Ethereum Sepolia"
 * rather than omitting the chain entirely.
 */
export async function getUnifiedBalance(address: string): Promise<UnifiedBalanceSnapshot> {
  const kit = getAppKit();
  const chains = UNIFIED_BALANCE_SUPPORTED_CHAINS.map(toUnifiedBalanceChain);

  // Typed loosely (not against @circle-fin/app-kit's own types) because
  // this repo's installed App Kit version's exact getBalances() return
  // shape wasn't available to check while writing this - the field names
  // below are copied verbatim from docs.arc.io/app-kit/tutorials/
  // unified-balance/check-unified-balance. Re-verify against the actual
  // installed package's .d.ts if this throws at runtime.
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

  // Response shape (see docs.arc.io/app-kit/tutorials/unified-balance/
  // check-unified-balance): { totalConfirmedBalance, totalPendingBalance,
  // breakdown: [{ depositor, breakdown: [{ chain, confirmedBalance,
  // pendingBalance }] }] }. Querying by a single address yields exactly
  // one depositor entry, but this defensively sums over all of them
  // (and de-dupes per chain) rather than assuming breakdown[0].
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
      if (!internalChain) continue; // chain we didn't ask about - ignore rather than guess
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

export interface UnifiedBalanceSpendResult {
  txHash: string;
  state: string;
  explorerUrl?: string;
}

/**
 * Spends `amount` (bigint, smallest USDC unit) from the Unified Balance
 * at `fromAddress`, delivered to `toAddress` on `destinationChain`. Lets
 * App Kit auto-select which confirmed source-chain balances to draw from
 * (no explicit `allocations` - see docs.arc.io/app-kit/tutorials/
 * unified-balance/select-source-blockchains) rather than Comparta trying
 * to pre-compute a route itself.
 *
 * Like sendViaAppKit() in appKit.ts, this only submits the spend - it
 * does not write any LedgerEntry/OnchainTransaction rows. See
 * lib/transfers/sendUnified.ts for that bookkeeping, and for why (same
 * as appKit.ts) a successful call here is treated as immediately final
 * rather than pending: App Kit's spend() resolves synchronously to a
 * terminal result per its documented examples.
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

  try {
    // Cast for the same reason as getUnifiedBalance() above - result
    // shape copied from docs.arc.io's spend() examples, not verified
    // against this repo's installed @circle-fin/app-kit .d.ts.
    const result = (await kit.unifiedBalance.spend({
      amount: toDecimalString(amount),
      from: { adapter, address: fromAddress },
      to: { adapter, chain, address: toAddress },
    })) as { txHash?: string; state?: string; explorerUrl?: string };
    if (!result?.txHash) {
      throw new UnifiedBalanceError("App Kit unifiedBalance.spend() returned no txHash");
    }
    return {
      txHash: result.txHash,
      state: result.state ?? "success",
      explorerUrl: (result as { explorerUrl?: string }).explorerUrl,
    };
  } catch (err) {
    if (err instanceof UnifiedBalanceError) throw err;
    throw new UnifiedBalanceError(
      `Unified Balance spend of ${toDecimalString(amount)} USDC from ${fromAddress} to ` +
        `${toAddress} on ${destinationChain} failed`,
      err
    );
  }
}
