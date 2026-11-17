// lib/paj/types.ts
//
// Wire types for the Paj v2 API (https://docs.paj.cash). Only the fields
// Comparta reads are listed; Paj may return more. Amounts are whole units
// ("25" means 25 USDC / ₦25), never smallest-unit integers.

export type PajCurrencyCode = "NGN" | "GHS" | "TZS" | "KES" | "ZAR" | "USD";

export type PajRateType = "onRamp" | "offRamp";

export interface PajRate {
  id: string;
  rate: number;
  type: PajRateType;
  baseCurrency: PajCurrencyCode;
  targetCurrency: string;
  createdAt: string | number;
}

export interface PajRates {
  onRampRate: PajRate;
  offRampRate: PajRate;
}

export interface PajBank {
  id: string;
  name: string;
  code: string;
  country: string;
  logo?: string | null;
}

export interface PajBankAccount {
  id: string;
  accountName: string;
  accountNumber: string;
  bank: string;
  /** Solana address that pays this bank account. */
  address: string;
  /** EVM address shared by every supported EVM chain (may be absent briefly). */
  evmAddress?: string;
}

export type PajChainCode =
  | "SOLANA"
  | "MONAD"
  | "ETHEREUM"
  | "BSC"
  | "BASE"
  | "ARC"
  | "ZCASH"
  | "SUI"
  | "NEAR"
  | "TON"
  | "ROBINHOOD";

/** Paj's order states. `PAID` is tolerated for older payloads. */
export type PajTransactionStatus =
  | "INIT"
  | "PAID"
  | "PROCESSING"
  | "COMPLETED"
  | "ERROR";

export type PajTransactionType = "ON_RAMP" | "OFF_RAMP";

export interface PajTransaction {
  id: string;
  address?: string;
  signature?: string;
  mint: string;
  currency: PajCurrencyCode;
  amount: number;
  usdcAmount?: number;
  fiatAmount: number;
  sender?: string;
  recipient?: string;
  rate: number;
  status: PajTransactionStatus;
  transactionType: PajTransactionType;
  createdAt: string;
  // Onramp virtual-account details.
  accountNumber?: string;
  accountName?: string;
  bank?: string;
  fee?: number;
  chain?: PajChainCode;
}

export interface CreateOnrampOrderInput {
  fiatAmount: number;
  currency: PajCurrencyCode;
  recipient: string;
  mint: string;
  chain: PajChainCode;
  webhookURL?: string;
  userExternalId?: string;
  businessUSDCFee?: number;
  customerId?: string;
}

export interface CreateOfframpOrderInput {
  accountNumber: string;
  bankCode: string;
  currency: PajCurrencyCode;
  amount: number;
  mint: string;
  chain: PajChainCode;
  webhookURL?: string;
  description?: string;
  businessUSDCFee?: number;
  customerId?: string;
}

export interface PajWebhookConfig {
  rampWebhookURL?: string;
  paymentWebhookURL?: string;
  kycWebhookURL?: string;
  checkoutWebhookURL?: string;
  /** Present on PATCH /pub/v2/webhook; the key's HMAC signing secret. */
  webhookSecret?: string;
}

export interface PajWebhookTestResult {
  url: string;
  delivered: boolean;
  durationMs: number;
  error?: string;
}

export interface PajOrderWebhookPayload {
  id: string;
  address?: string;
  signature?: string;
  mint: string;
  currency: PajCurrencyCode;
  amount: number;
  usdcAmount?: number;
  fiatAmount: number;
  sender?: string;
  recipient?: string;
  rate: number;
  status: PajTransactionStatus;
  transactionType: PajTransactionType;
  accountNumber?: string;
  accountName?: string;
  bank?: string;
  fee?: number;
  chain?: PajChainCode;
}
