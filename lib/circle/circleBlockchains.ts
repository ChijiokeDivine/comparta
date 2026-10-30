import type { Chain } from "@/app/generated/prisma/client";
import {
  CIRCLE_BLOCKCHAIN_CODES,
  getNetworkProfile,
  type CircleBlockchainCode,
} from "@/lib/config/networkProfiles";
import { resolveAppNetwork } from "@/lib/config/network";

/**
 * Circle Developer Wallets API blockchain codes we can create/derive SCAs
 * on. Kept in one table in lib/config/networkProfiles.ts so the wallet
 * derivation path, chain mapping and UI never drift apart.
 */
export const CHAIN_TO_CIRCLE_BLOCKCHAIN: Partial<Record<Chain, string>> = {
  ...CIRCLE_BLOCKCHAIN_CODES,
};

/**
 * Chains we provision SCAs for so Unified Balance deposit can sign.
 * Network-aware: Sepolia family on testnet, Ethereum/Base/Arbitrum on
 * mainnet, plus the settlement chain (Arc) in both cases.
 */
export function getUnifiedBalanceProvisionChains(): Chain[] {
  return getNetworkProfile(resolveAppNetwork()).depositSourceChains as Chain[];
}

export function toCircleBlockchain(chain: Chain): CircleBlockchainCode {
  const code = CIRCLE_BLOCKCHAIN_CODES[chain];
  if (!code) {
    throw new Error(`No Circle blockchain code for Comparta chain "${chain}"`);
  }
  return code;
}
