// lib/config/networkProfiles.ts
//
// Pure, dependency-free description of the two Arc networks Comparta can
// run against. NOTHING in this file reads process.env, so it is safe to
// import from both server code and client components.
//
// Resolving *which* profile to use lives in lib/config/network.ts (server/
// build-time only). This file only answers "what are the facts about
// mainnet vs testnet" — chain ids, RPCs, explorer URLs, Circle codes,
// Unified Balance chain support — so those facts are written down exactly
// once instead of being re-derived (and occasionally mis-typed) per module.
//
// Verified against:
//   - https://docs.arc.io/arc/references/rpc-endpoints   (chain ids, RPCs, explorers)
//   - https://www.circle.com/multi-chain-usdc            (USDC 0x3600…0000 on both networks)
//   - @circle-fin/app-kit@1.19 chains.d.ts              (Arc mainnet = "Arc", testnet = "Arc_Testnet")
//   - @circle-fin/developer-controlled-wallets          (EvmBlockchainId: Arc = 5042, ArcTestnet = 5042002)

export type AppNetwork = "testnet" | "mainnet";

export type ArcChain = "ARC_TESTNET" | "ARC_MAINNET";

/** Circle Developer-Controlled Wallets `blockchain` code. */
export type CircleBlockchainCode =
  | "ARC"
  | "ARC-TESTNET"
  | "ETH"
  | "ETH-SEPOLIA"
  | "BASE"
  | "BASE-SEPOLIA"
  | "ARB"
  | "ARB-SEPOLIA";

/** App Kit chain literal (Send + Unified Balance). */
export type AppKitChainCode =
  | "Arc"
  | "Arc_Testnet"
  | "Ethereum"
  | "Ethereum_Sepolia"
  | "Base"
  | "Base_Sepolia"
  | "Arbitrum"
  | "Arbitrum_Sepolia";

export interface NetworkProfile {
  readonly network: AppNetwork;
  readonly isMainnet: boolean;
  /** Display label for the settlement chain ("Arc" / "Arc Testnet"). */
  readonly settlementLabel: string;
  readonly chain: ArcChain;
  readonly chainId: number;
  readonly circleEnvironment: "sandbox" | "production";
  readonly circleBlockchain: CircleBlockchainCode;
  readonly appKitChain: AppKitChainCode;
  readonly rpcUrl: string;
  readonly explorerBaseUrl: string;
  /** ERC-20 USDC interface address (6 decimals) — same predeploy on both networks. */
  readonly usdcAddress: `0x${string}`;
  /**
   * Chains wired into Circle Gateway's Unified Balance for this network.
   * Values are Comparta's internal `Chain` enum strings.
   */
  readonly unifiedBalanceChains: readonly string[];
  /**
   * Subset of unifiedBalanceChains Comparta can DERIVE a Circle wallet on
   * (needed to sign a deposit out of that chain). Internal Chain strings.
   */
  readonly depositSourceChains: readonly string[];
  /** Human labels for every chain above, keyed by internal Chain string. */
  readonly chainLabels: Readonly<Record<string, string>>;
}

/**
 * Comparta's internal Chain enum values → Circle Developer-Controlled
 * Wallets blockchain codes. Single source of truth reused by
 * lib/circle/circleBlockchains.ts and the wallet-derivation path.
 */
export const CIRCLE_BLOCKCHAIN_CODES: Readonly<Record<string, CircleBlockchainCode>> = {
  ARC_MAINNET: "ARC",
  ARC_TESTNET: "ARC-TESTNET",
  ETH_MAINNET: "ETH",
  ETH_SEPOLIA: "ETH-SEPOLIA",
  BASE: "BASE",
  BASE_SEPOLIA: "BASE-SEPOLIA",
  ARBITRUM: "ARB",
  ARBITRUM_SEPOLIA: "ARB-SEPOLIA",
};

/** Internal Chain → App Kit chain literal, for every chain we can map. */
export const APPKIT_CHAIN_CODES: Readonly<Record<string, AppKitChainCode>> = {
  ARC_MAINNET: "Arc",
  ARC_TESTNET: "Arc_Testnet",
  ETH_MAINNET: "Ethereum",
  ETH_SEPOLIA: "Ethereum_Sepolia",
  BASE: "Base",
  BASE_SEPOLIA: "Base_Sepolia",
  ARBITRUM: "Arbitrum",
  ARBITRUM_SEPOLIA: "Arbitrum_Sepolia",
};

const TESTNET_PROFILE: NetworkProfile = {
  network: "testnet",
  isMainnet: false,
  settlementLabel: "Arc Testnet",
  chain: "ARC_TESTNET",
  chainId: 5042002,
  circleEnvironment: "sandbox",
  circleBlockchain: "ARC-TESTNET",
  appKitChain: "Arc_Testnet",
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerBaseUrl: "https://explorer.testnet.arc.io",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  unifiedBalanceChains: [
    "ARC_TESTNET",
    "ETH_SEPOLIA",
    "BASE_SEPOLIA",
    "ARBITRUM_SEPOLIA",
  ],
  depositSourceChains: [
    "ARC_TESTNET",
    "ETH_SEPOLIA",
    "BASE_SEPOLIA",
    "ARBITRUM_SEPOLIA",
  ],
  chainLabels: {
    ARC_TESTNET: "Arc Testnet",
    ETH_SEPOLIA: "Ethereum Sepolia",
    BASE_SEPOLIA: "Base Sepolia",
    ARBITRUM_SEPOLIA: "Arbitrum Sepolia",
  },
};

const MAINNET_PROFILE: NetworkProfile = {
  network: "mainnet",
  isMainnet: true,
  settlementLabel: "Arc",
  chain: "ARC_MAINNET",
  chainId: 5042,
  circleEnvironment: "production",
  circleBlockchain: "ARC",
  appKitChain: "Arc",
  rpcUrl: "https://rpc.mainnet.arc.io",
  explorerBaseUrl: "https://explorer.arc.io",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  unifiedBalanceChains: ["ARC_MAINNET", "ETH_MAINNET", "BASE", "ARBITRUM"],
  depositSourceChains: ["ARC_MAINNET", "ETH_MAINNET", "BASE", "ARBITRUM"],
  chainLabels: {
    ARC_MAINNET: "Arc",
    ETH_MAINNET: "Ethereum",
    BASE: "Base",
    ARBITRUM: "Arbitrum",
  },
};

export const NETWORK_PROFILES: Readonly<Record<AppNetwork, NetworkProfile>> = {
  testnet: TESTNET_PROFILE,
  mainnet: MAINNET_PROFILE,
};

export function getNetworkProfile(network: AppNetwork): NetworkProfile {
  return NETWORK_PROFILES[network];
}

export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** Explorer URL for a tx hash on the given network. */
export function explorerTxUrl(network: AppNetwork, txHash: string): string {
  return `${getNetworkProfile(network).explorerBaseUrl}/tx/${txHash}`;
}
