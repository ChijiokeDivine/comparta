// lib/config/clientChains.ts
//
// Client-safe chain lists for the UI (deposit modal, transfer form, unified
// balance forms). The network is decided ONCE by next.config.ts and inlined
// as NEXT_PUBLIC_APP_NETWORK, so these lists automatically show Arc mainnet
// on a production deployment and the Sepolia family locally/preview.
//
// This module deliberately imports only from networkProfiles.ts (no env
// access) plus the public env flag — never lib/config/network.ts, which
// reads the server environment.

import type { Chain } from "@/app/generated/prisma/client";
import { getNetworkProfile, type AppNetwork } from "./networkProfiles";

export const CLIENT_NETWORK: AppNetwork =
  process.env.NEXT_PUBLIC_APP_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const CLIENT_NETWORK_PROFILE = getNetworkProfile(CLIENT_NETWORK);

export const IS_MAINNET = CLIENT_NETWORK_PROFILE.isMainnet;

/** Internal `Chain` enum value for the chain Comparta settles on. */
export const SETTLEMENT_CHAIN = CLIENT_NETWORK_PROFILE.chain;
/** Display label: "Arc" on mainnet, "Arc Testnet" on testnet. */
export const SETTLEMENT_CHAIN_LABEL = CLIENT_NETWORK_PROFILE.settlementLabel;
export const SETTLEMENT_CHAIN_ID = CLIENT_NETWORK_PROFILE.chainId;
export const SETTLEMENT_EXPLORER_URL = CLIENT_NETWORK_PROFILE.explorerBaseUrl;

export interface ClientChainOption {
  value: Chain;
  label: string;
  /** True for the chain Comparta's treasury wallet natively settles on. */
  isSettlement: boolean;
}

function toOptions(chains: readonly string[]): ClientChainOption[] {
  const labels = CLIENT_NETWORK_PROFILE.chainLabels;
  return chains.map((value) => ({
    value: value as Chain,
    label: labels[value] ?? value,
    isSettlement: value === SETTLEMENT_CHAIN,
  }));
}

/**
 * Chains a payer can deposit on. The settlement chain is always first and
 * selected by default — it's the only one that settles without an extra
 * Gateway deposit step.
 */
export const DEPOSIT_CHAINS: ClientChainOption[] = toOptions(
  CLIENT_NETWORK_PROFILE.unifiedBalanceChains
);

/** Chains an outbound cross-chain transfer can target. */
export const TRANSFER_DESTINATION_CHAINS: ClientChainOption[] = [...DEPOSIT_CHAINS];

/** Chains a Unified Balance deposit can come from. */
export const UNIFIED_DEPOSIT_SOURCE_CHAINS: ClientChainOption[] = toOptions(
  CLIENT_NETWORK_PROFILE.depositSourceChains
);

/** Chains a Unified Balance spend can target. */
export const UNIFIED_SPEND_DESTINATION_CHAINS: ClientChainOption[] = [...DEPOSIT_CHAINS];

export function chainLabel(chain: string): string {
  return CLIENT_NETWORK_PROFILE.chainLabels[chain] ?? chain;
}
