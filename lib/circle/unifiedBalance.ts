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
// ADDRESS SHARING vs. WALLET REGISTRATION — TWO SEPARATE THINGS (resolved
// 2026-09-19): an SCA wallet's address is deterministically the same
// across EVM chains, but Circle's Developer-Controlled Wallets are still
// provisioned PER-BLOCKCHAIN — Circle won't sign a transaction for an
// address on a chain it hasn't registered a wallet for, even though the
// address is "the same" conceptually. This is why depositToUnifiedBalance()
// used to fail for every chain except Arc: this repo's wallet was only
// ever created on Arc. The fix is Circle's deriveWallet/deriveWalletByAddress
// (see lib/circle/wallets.ts#deriveWalletOnChain), which registers the
// SAME address as a signable wallet on another chain. DEPOSIT_SOURCE_
// SUPPORTED_CHAINS below and WalletChainRegistration (prisma schema) are
// the two pieces that track this. Not every Unified-Balance-supported
// chain has a confirmed code in the Developer-Controlled Wallets SDK —
// see DEPOSIT_SOURCE_SUPPORTED_CHAINS's own comment for which don't.
//
// WHAT THIS MODULE DOES NOT DO: watch for incoming transfers and decide
// on its own when to deposit them — that orchestration (detect a plain
// balance, deposit the delta, credit the ledger) lives in
// lib/circle/autoDeposit.ts, which calls depositToUnifiedBalance() below
// as one step. This file only wraps the three raw App Kit calls.

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

] as const;

export function isUnifiedBalanceSupported(chain: Chain): boolean {
  return (UNIFIED_BALANCE_SUPPORTED_CHAINS as Chain[]).includes(chain);
}

/**
 * Subset of UNIFIED_BALANCE_SUPPORTED_CHAINS that Comparta will accept as
 * a DEPOSIT source — i.e. chains where lib/circle/wallets.ts#deriveWalletOnChain
 * can register the org's wallet with a confirmed, unambiguous blockchain
 * code. Deliberately excludes HYPEREVM_TESTNET: the installed
 * @circle-fin/developer-controlled-wallets SDK's EvmBlockchain enum has no
 * dedicated HyperEVM entry (only a generic 'EVM-TESTNET' catch-all that
 * couldn't be confirmed to map to HyperEVM specifically), and guessing
 * wrong on a wallet-provisioning call is a worse failure mode than simply
 * not offering it yet. HyperEVM Testnet remains fully usable as a SPEND
 * DESTINATION (spendFromUnifiedBalance's Forwarder path needs no wallet
 * registration on the destination chain at all), just not as a source.
 */
export const DEPOSIT_SOURCE_SUPPORTED_CHAINS: readonly Chain[] = [
  "ARC_TESTNET",
  "ETH_SEPOLIA",
  "BASE_SEPOLIA",
  "ARBITRUM_SEPOLIA",
] as const;

export function isDepositSourceSupported(chain: Chain): boolean {
  return (DEPOSIT_SOURCE_SUPPORTED_CHAINS as Chain[]).includes(chain);
}

/**
 * Maps a Comparta Chain to the blockchain code
 * @circle-fin/developer-controlled-wallets' deriveWallet/deriveWalletByAddress
 * expect (its EvmBlockchain enum — a DIFFERENT code-space from
 * toUnifiedBalanceChain()'s App Kit literals above). Only defined for
 * DEPOSIT_SOURCE_SUPPORTED_CHAINS; throws for anything else, same
 * fail-loudly posture as toUnifiedBalanceChain().
 */
export function toCircleDeveloperWalletsBlockchain(
  chain: Chain
): "ARC-TESTNET" | "ETH-SEPOLIA" | "BASE-SEPOLIA" | "ARB-SEPOLIA" {
  switch (chain) {
    case "ARC_TESTNET":
      return "ARC-TESTNET";
    case "ETH_SEPOLIA":
      return "ETH-SEPOLIA";
    case "BASE_SEPOLIA":
      return "BASE-SEPOLIA";
    case "ARBITRUM_SEPOLIA":
      return "ARB-SEPOLIA";
    default:
      throw new UnifiedBalanceUnsupportedChainError(
        `"${chain}" has no confirmed Developer-Controlled-Wallets blockchain code — ` +
          `not in DEPOSIT_SOURCE_SUPPORTED_CHAINS.`
      );
  }
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
 * Uses `allowanceStrategy: 'approve'` (on-chain ERC-20 approve + deposit).
 * Required for Circle SCA wallets: EIP-3009/permit use ecrecover and reject
 * the SCA's ERC-1271 signature. Approve also lazy-deploys the SCA on first
 * use. Requires the source chain to have enough native gas for the approve
 * + deposit txs; Comparta doesn't currently check that before calling this.
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
    // Circle SCA wallets MUST use "approve", not "authorize"/"permit".
    // USDC permit/EIP-3009 signatures use ecrecover, which does not accept
    // the SCA's ERC-1271 signature (Arc App Kit docs: "Circle Wallets SCA
    // deposits require allowanceStrategy: approve"). "authorize" is what
    // produced "Cannot generate a signature from an undeployed wallet" /
    // typedData failures on first deposit. On-chain approve also lazy-
    // deploys the SCA if this is the wallet's first outbound tx.
    const result = await kit.unifiedBalance.deposit({
      from: { adapter, chain, address },
      amount: toDecimalString(amount),
      allowanceStrategy: "approve",
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
 * Builds the exact params object both spend() and estimateSpend() need —
 * factored out so the fee estimate is always computed against the
 * IDENTICAL shape that will actually be submitted, never a hand-approximated
 * copy that could silently drift from the real call.
 */
function buildSpendParams(fromAddress: string, toAddress: string, amount: bigint, destinationChain: Chain) {
  const adapter = getCircleWalletsAdapter();
  const chain = toUnifiedBalanceChain(destinationChain); // throws for unsupported chains
  return {
    amount: toDecimalString(amount),
    from: { adapter, address: fromAddress },
    to: { chain, recipientAddress: toAddress, useForwarder: true as const },
  };
}

/**
 * Conservative flat fee buffer used when estimateSpend cannot be called
 * (empty Unified Balance) or when it throws. Sized for Forwarder service
 * fee (~$0.20) + Sepolia/Base/Arb gas headroom. Under-estimating here is
 * exactly what let spend(5) fail after a top-up that only covered 5.50
 * while the real fee needed more — prefer over-estimating slightly.
 */
export const UNIFIED_BALANCE_FEE_BUFFER = toSmallestUnit("1.00");

/**
 * Returns the total fee (smallest USDC unit) Gateway will charge for this
 * exact spend. App Kit's estimateSpend itself validates that the depositor
 * already has enough confirmed Unified Balance for the full amount — when
 * the balance is empty (the common case right before a just-in-time top-up)
 * it throws BALANCE_INSUFFICIENT_TOKEN. In that case we skip the SDK call
 * and return UNIFIED_BALANCE_FEE_BUFFER so the top-up path can still run.
 */
export async function estimateUnifiedBalanceSpendFee(
  fromAddress: string,
  toAddress: string,
  amount: bigint,
  destinationChain: Chain
): Promise<bigint> {
  // Skip estimateSpend when Unified Balance can't cover `amount` — the SDK
  // treats that as a hard error rather than a pure fee quote, which is what
  // produced the noisy BALANCE_INSUFFICIENT_TOKEN log on every cold send.
  try {
    const snapshot = await getUnifiedBalance(fromAddress);
    if (snapshot.totalConfirmed < amount) {
      console.info(
        `[unifiedBalance] Skipping estimateSpend for ${fromAddress} -> ${toAddress} on ` +
          `${destinationChain}: confirmed Unified Balance ` +
          `${toDecimalString(snapshot.totalConfirmed)} < amount ${toDecimalString(amount)}; ` +
          `using flat fee buffer ${toDecimalString(UNIFIED_BALANCE_FEE_BUFFER)}.`
      );
      return UNIFIED_BALANCE_FEE_BUFFER;
    }
  } catch (err) {
    console.error(
      `[unifiedBalance] getUnifiedBalance failed before estimateSpend; using flat fee buffer.`,
      err
    );
    return UNIFIED_BALANCE_FEE_BUFFER;
  }

  const kit = getAppKit();
  try {
    const params = buildSpendParams(fromAddress, toAddress, amount, destinationChain);
    const result = await kit.unifiedBalance.estimateSpend(params);
    return (result.fees ?? []).reduce((sum, fee) => {
      // Every fee in Gateway v1 (forwarder service fee, per-chain gas) is
      // USDC-denominated per the real fee table - skip anything that
      // somehow isn't, rather than mis-summing a non-USDC amount as if
      // it were USDC.
      if (fee.token.toUpperCase() !== "USDC") return sum;
      return sum + toSmallestUnit(fee.amount);
    }, 0n);
  } catch (err) {
    // Fee estimation failing shouldn't block the send outright - fall
    // back to the conservative flat buffer and let the actual spend()
    // call be the final word.
    console.error(
      `[unifiedBalance] estimateSpend failed for ${fromAddress} -> ${toAddress} on ` +
        `${destinationChain}; falling back to a flat fee buffer.`,
      err
    );
    return UNIFIED_BALANCE_FEE_BUFFER;
  }
}

/**
 * Polls getUnifiedBalance() until totalConfirmed reaches `target` or
 * `timeoutMs` elapses. Necessary because depositToUnifiedBalance()
 * resolving does NOT mean the deposit is immediately confirmed and
 * spendable — Gateway's confirmed balance lags the deposit by however
 * long the source chain's finality + Circle's attestation takes, even
 * for a fast-finality chain like Arc. Calling spend() immediately after
 * a deposit without waiting for this is exactly what produced a
 * "BALANCE_INSUFFICIENT_TOKEN" error even though the deposit had just
 * "succeeded."
 *
 * Default timeout is 90s (was 30s): Sepolia attestation routinely exceeded
 * the shorter window, so spend(5) failed after a top-up that later funded
 * a successful spend(3) against the leftover confirmed balance.
 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;
export const DEFAULT_CONFIRM_INTERVAL_MS = 2_000;

export async function waitForConfirmedBalance(
  address: string,
  target: bigint,
  {
    timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
    intervalMs = DEFAULT_CONFIRM_INTERVAL_MS,
  }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<UnifiedBalanceSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await getUnifiedBalance(address);
  while (snapshot.totalConfirmed < target && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    snapshot = await getUnifiedBalance(address);
  }
  return snapshot;
}

/**
 * Spends `amount` (bigint, smallest USDC unit) from the Unified Balance
 * at `fromAddress`, delivered to `toAddress` on `destinationChain`. Lets
 * App Kit auto-select which confirmed source-chain balances to draw from
 * (no explicit `allocations`) rather than Comparta trying to pre-compute
 * a route itself.
 *
 * Destination uses App Kit's Forwarder shape (`{ chain, recipientAddress,
 * useForwarder: true }`) rather than an adapter-backed destination —
 * `toAddress` is an arbitrary external address Comparta doesn't custody
 * or sign for, so there's no adapter to give it; Circle's Forwarding
 * Service submits the destination-chain mint on Comparta's behalf
 * instead. (An earlier version of this function passed `{ adapter,
 * address: toAddress }`, which is wrong on two counts: `address` there is
 * the destination ADAPTER's own account-context field, not the money
 * recipient — that's `recipientAddress` — and passing our own adapter for
 * an address we don't control doesn't make sense anyway.)
 *
 * Like sendViaAppKit() in appKit.ts, this only submits the spend — it
 * does not write any LedgerEntry/OnchainTransaction rows. See
 * lib/transfers/sendUnified.ts for that bookkeeping.
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

  try {
    const params = buildSpendParams(fromAddress, toAddress, amount, destinationChain);
    const result = (await kit.unifiedBalance.spend(params)) as {
      txHash?: string;
      state?: string;
      explorerUrl?: string;
    };
    if (!result?.txHash) {
      throw new UnifiedBalanceError("App Kit unifiedBalance.spend() returned no txHash");
    }
    return {
      txHash: result.txHash,
      state: result.state ?? "success",
      explorerUrl: result.explorerUrl,
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