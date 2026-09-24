// lib/circle/chainMapping.ts
//
// Circle's API/webhooks identify chains with strings like "ARC-TESTNET",
// "ETH-SEPOLIA", "MATIC-AMOY", "SOL-DEVNET". Our Chain enum is coarser
// (mainnet/testnet collapsed per network family in a few cases) - this is
// the one place that translation happens, so inbound webhook handling and
// anything else touching Circle's raw chain strings stays consistent.
//
// IMPORTANT - scope of this file vs. lib/circle/unifiedBalance.ts:
// This mapping only matters for chains where CIRCLE calls US (Developer-
// Controlled Wallets webhooks, lib/transfers/receive.ts). Unified Balance
// deposits on Base Sepolia / Ethereum Sepolia / Arbitrum Sepolia / HyperEVM
// Testnet do NOT arrive as Circle webhooks at all - App Kit's Unified
// Balance is read via kit.unifiedBalance.getBalances() polling Gateway
// directly (see unifiedBalance.ts), against the org wallet's existing
// arcAddress, which is the same address on every EVM chain for an SCA
// wallet. So a mapping entry here is NOT a prerequisite for a chain to
// work with Unified Balance, and the reverse holds too - a chain can be
// mapped here (for webhook/display purposes) without being Unified-
// Balance-supported. See unifiedBalance.ts's module docstring for which
// chains are actually wired into Unified Balance.

import type { Chain } from "@/app/generated/prisma/client";

const CIRCLE_TO_INTERNAL: Record<string, Chain> = {
  ARC: "ARC_MAINNET",
  "ARC-TESTNET": "ARC_TESTNET",
  "ETH-SEPOLIA": "ETH_SEPOLIA",
  ETH: "ETH_MAINNET",
  "MATIC-AMOY": "BASE", // placeholder mapping until a dedicated Polygon enum value exists
  SOL: "SOLANA",
  "SOL-DEVNET": "SOLANA",
  BASE: "BASE",
  AVAX: "AVAX",
  "AVAX-FUJI": "AVAX",
  ARB: "ARBITRUM",

  // ── Added for Unified Balance rollout (see module docstring above) ──
  // "BASE-SEPOLIA" and "ARB-SEPOLIA" previously fell through to the
  // generic BASE/ARBITRUM rows above, which meant an inbound webhook
  // (if Circle ever sent one for these - see note above, it normally
  // won't for Unified Balance deposits) couldn't be told apart from a
  // mainnet transfer. Now that BASE_SEPOLIA/ARBITRUM_SEPOLIA exist as
  // their own Chain values, point at those instead.
  "BASE-SEPOLIA": "BASE_SEPOLIA",
  "ARB-SEPOLIA": "ARBITRUM_SEPOLIA",

  // UNVERIFIED - Circle's docs (as of 2026-09-18) don't show an explicit
  // webhook `blockchain` string for HyperEVM Testnet anywhere this was
  // built from. This follows the same "<CODE>-TESTNET" pattern as every
  // other confirmed entry above (e.g. "ARC-TESTNET"), but per this file's
  // own convention (see the old "MATIC-AMOY" comment), an inferred string
  // gets called out rather than treated as trustworthy. Confirm against a
  // real webhook payload (or the Circle console) before relying on it.
  // "HYPEREVM-TESTNET": "HYPEREVM_TESTNET",

  // Deliberately NOT mapped: Celo and Monad testnet. Neither has a Chain
  // enum value at all (see prisma/schema.prisma) - Unified Balance
  // doesn't support either yet, so there's nothing for a webhook string
  // to map to. Add both back here (and to the enum) together, only once
  // Circle's docs confirm Unified Balance support for one of them.
};

/**
 * Best-effort mapping from a Circle blockchain string to our Chain enum.
 * Returns null for anything unrecognized rather than guessing - callers
 * should treat null as "record the raw string, don't assume a chain."
 */
export function mapCircleBlockchain(circleBlockchain: string | undefined | null): Chain | null {
  if (!circleBlockchain) return null;
  return CIRCLE_TO_INTERNAL[circleBlockchain.toUpperCase()] ?? null;
}
