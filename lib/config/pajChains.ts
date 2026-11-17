// lib/config/pajChains.ts
//
// Client-safe facts about Paj's supported chains and settlement tokens.
// NO env access here, so both server and client components can import it.
//
// Only Arc is enabled today. Adding a chain is a one-line change:
//   1. flip `enabled` to true below
//   2. map the Comparta wallet chain to it in lib/paj/config.ts
//   3. (if new EVM chain) add that wallet chain to the Chain enum + Circle
//      network profile
// Nothing in the UI or API routes hardcodes "ARC"; they all read this list.
//
// Token addresses verified against https://docs.paj.cash/concepts/chains.

export type PajChainId =
  | "ARC"
  | "ETHEREUM"
  | "BASE"
  | "BSC"
  | "MONAD"
  | "SOLANA"
  | "TON";

export interface PajChainOption {
  id: PajChainId;
  /** Human label used in every chain picker. */
  label: string;
  /** Whether bank on/off ramp is live on this chain *for Comparta today*. */
  enabled: boolean;
  /** Settlement stablecoin ticker. */
  tokenSymbol: "USDC" | "USDT";
  /** Mint / ERC-20 contract / jetton master. */
  tokenMint: string;
  decimals: number;
}

export const PAJ_CHAINS: readonly PajChainOption[] = [
  {
    id: "ARC",
    label: "Arc",
    enabled: true,
    tokenSymbol: "USDC",
    tokenMint: "0x3600000000000000000000000000000000000000",
    decimals: 6,
  },
  {
    id: "ETHEREUM",
    label: "Ethereum",
    enabled: false,
    tokenSymbol: "USDC",
    tokenMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  {
    id: "BASE",
    label: "Base",
    enabled: false,
    tokenSymbol: "USDC",
    tokenMint: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  {
    id: "BSC",
    label: "BNB Smart Chain",
    enabled: false,
    tokenSymbol: "USDC",
    tokenMint: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
  },
  {
    id: "MONAD",
    label: "Monad",
    enabled: false,
    tokenSymbol: "USDC",
    tokenMint: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    decimals: 6,
  },
  {
    id: "SOLANA",
    label: "Solana",
    enabled: false,
    tokenSymbol: "USDC",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
  {
    id: "TON",
    label: "TON",
    enabled: false,
    tokenSymbol: "USDT",
    tokenMint: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    decimals: 6,
  },
] as const;

export const PAJ_ACTIVE_CHAINS: readonly PajChainOption[] = PAJ_CHAINS.filter(
  (chain) => chain.enabled
);

export function getPajChain(id: string | null | undefined): PajChainOption | null {
  return PAJ_CHAINS.find((chain) => chain.id === id) ?? null;
}

export const PAJ_CURRENCY = "NGN" as const;
export const PAJ_CURRENCY_SYMBOL = "₦";

/**
 * Formats a naira amount without floats creeping into the UI. Accepts the
 * strings Prisma returns for Decimal columns or the numbers Paj returns.
 */
export function formatNaira(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "₦0";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "₦0";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(n);
}

/** "0123456789" -> "•••• 6789" */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `•••• ${accountNumber.slice(-4)}`;
}
