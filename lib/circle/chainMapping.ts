// lib/circle/chainMapping.ts
//
// Circle's API/webhooks identify chains with strings like "ARC-TESTNET",
// "ETH-SEPOLIA", "MATIC-AMOY", "SOL-DEVNET". Our Chain enum is coarser
// (mainnet/testnet collapsed per network family in a few cases) — this is
// the one place that translation happens, so inbound webhook handling and
// anything else touching Circle's raw chain strings stays consistent.

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
  "BASE-SEPOLIA": "BASE",
  AVAX: "AVAX",
  "AVAX-FUJI": "AVAX",
  ARB: "ARBITRUM",
  "ARB-SEPOLIA": "ARBITRUM",
};

/**
 * Best-effort mapping from a Circle blockchain string to our Chain enum.
 * Returns null for anything unrecognized rather than guessing — callers
 * should treat null as "record the raw string, don't assume a chain."
 */
export function mapCircleBlockchain(circleBlockchain: string | undefined | null): Chain | null {
  if (!circleBlockchain) return null;
  return CIRCLE_TO_INTERNAL[circleBlockchain.toUpperCase()] ?? null;
}