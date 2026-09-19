import type { Chain } from "@/app/generated/prisma/client";
import { UNIFIED_BALANCE_SUPPORTED_CHAINS } from "./unifiedBalance";

/** Circle Developer Wallets API blockchain codes we can create SCAs on. */
export const CHAIN_TO_CIRCLE_BLOCKCHAIN: Partial<Record<Chain, string>> = {
  ARC_TESTNET: "ARC-TESTNET",
  ARC_MAINNET: "ARC",
  ETH_SEPOLIA: "ETH-SEPOLIA",
  ETH_MAINNET: "ETH",
  BASE_SEPOLIA: "BASE-SEPOLIA",
  ARBITRUM_SEPOLIA: "ARB-SEPOLIA",
  // HyperEVM Testnet: confirm Circle DCW supports wallet create before enabling.
  // HYPEREVM_TESTNET: "HYPEREVM-TESTNET",
};

/** Chains we provision SCAs for so Unified Balance deposit can sign. */
export function getUnifiedBalanceProvisionChains(): Chain[] {
  return UNIFIED_BALANCE_SUPPORTED_CHAINS.filter(
    (c) => CHAIN_TO_CIRCLE_BLOCKCHAIN[c] != null
  );
}

export function toCircleBlockchain(chain: Chain): string {
  const code = CHAIN_TO_CIRCLE_BLOCKCHAIN[chain];
  if (!code) {
    throw new Error(`No Circle blockchain code for Comparta chain "${chain}"`);
  }
  return code;
}