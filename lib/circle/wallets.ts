// lib/circle/wallets.ts
//
// Thin, typed functions over the Circle Developer-Controlled Wallets SDK.
// This is the ONLY module in the codebase allowed to call the Circle SDK
// directly for wallet/transaction operations — everything else (API
// routes, jobs) should go through these functions so custody logic stays
// in one place.

import { getCircleClient, getArcBlockchain } from "./client";
import { getEnv } from "@/lib/env";
import { toDecimalString } from "./amount";
import { randomUUID } from "node:crypto";
import { sendViaAppKit, AppKitSendError } from "./appKit";
export class CircleApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CircleApiError";
  }
}

let cachedWalletSetId: string | null = null;

/**
 * Returns the wallet set that new org wallets get created under, creating
 * one on first use if CIRCLE_WALLET_SET_ID isn't configured. In production
 * you should set CIRCLE_WALLET_SET_ID explicitly so restarts don't risk
 * spawning duplicate wallet sets.
 */
async function getOrCreateWalletSet(): Promise<string> {
  const env = getEnv();
  if (env.CIRCLE_WALLET_SET_ID) return env.CIRCLE_WALLET_SET_ID;
  if (cachedWalletSetId) return cachedWalletSetId;

  const client = getCircleClient();
  const res = await client.createWalletSet({
    name: `comparta-${env.CIRCLE_ENVIRONMENT}`,
  });
  const id = res.data?.walletSet?.id;
  if (!id) {
    throw new CircleApiError("Circle createWalletSet returned no wallet set id");
  }
  console.warn(
    `[circle] No CIRCLE_WALLET_SET_ID configured — created wallet set ${id}. ` +
      `Persist this into your env config to avoid creating a new one on every cold start.`
  );
  cachedWalletSetId = id;
  return id;
}

export interface CreatedWallet {
  circleWalletId: string;
  arcAddress: string;
  chain: string;
}

/**
 * Provisions a new Circle Developer-Controlled Wallet on Arc for an org.
 * Uses a Smart Contract Account (SCA) wallet, which is what Circle
 * recommends for application-controlled custody.
 */
export async function createWalletForOrg(orgId: string): Promise<CreatedWallet> {
  const client = getCircleClient();
  const walletSetId = await getOrCreateWalletSet();
  const blockchain = getArcBlockchain();

  try {
    const res = await client.createWallets({
      blockchains: [blockchain],
      accountType: "SCA",
      count: 1,
      walletSetId,
      metadata: [{ name: `org:${orgId}`, refId: orgId }],
    });

    const wallet = res.data?.wallets?.[0];
    if (!wallet?.id || !wallet?.address) {
      throw new CircleApiError(
        `Circle createWallets returned no usable wallet for org ${orgId}`
      );
    }

    return {
      circleWalletId: wallet.id,
      arcAddress: wallet.address,
      chain: blockchain,
    };
  } catch (err) {
    throw new CircleApiError(`Failed to create Arc wallet for org ${orgId}`, err);
  }
}

/**
 * Provisions a new, single-purpose Circle Developer-Controlled Wallet for
 * one payment-link wallet-checkout session (lib/paymentLinks/
 * checkout.ts#startWalletCheckout). Same wallet set / SCA account type as
 * createWalletForOrg above - the only difference is what it's for: this
 * address is shown directly to an anonymous payer, so it must never be
 * the org's own treasury wallet.arcAddress. Once a deposit lands here,
 * lib/paymentLinks/reconciliation.ts#reconcileDepositWalletPayment sweeps
 * it on to the org's real wallet before the checkout session is confirmed.
 *
 * Deliberately NOT refactored to share a helper with createWalletForOrg -
 * same body, kept separate so a change to one provisioning path can't
 * silently affect the other.
 */
export async function createWalletForPaymentLinkPayment(paymentLinkPaymentId: string): Promise<CreatedWallet> {
  const client = getCircleClient();
  const walletSetId = await getOrCreateWalletSet();
  const blockchain = getArcBlockchain();

  try {
    const res = await client.createWallets({
      blockchains: [blockchain],
      accountType: "SCA",
      count: 1,
      walletSetId,
      metadata: [{ name: `payment-link-payment:${paymentLinkPaymentId}`, refId: paymentLinkPaymentId }],
    });

    const wallet = res.data?.wallets?.[0];
    if (!wallet?.id || !wallet?.address) {
      throw new CircleApiError(
        `Circle createWallets returned no usable deposit wallet for payment-link payment ${paymentLinkPaymentId}`
      );
    }

    return {
      circleWalletId: wallet.id,
      arcAddress: wallet.address,
      chain: blockchain,
    };
  } catch (err) {
    throw new CircleApiError(
      `Failed to create Arc deposit wallet for payment-link payment ${paymentLinkPaymentId}`,
      err
    );
  }
}

export interface WalletBalance {
  tokenSymbol: string;
  tokenId: string;
  amount: string; // decimal string, as returned by Circle
}

/** Reads all token balances for a wallet directly from Circle (source of truth on-chain). */
export async function getWalletBalance(circleWalletId: string): Promise<WalletBalance[]> {
  const client = getCircleClient();
  try {
    const res = await client.getWalletTokenBalance({ id: circleWalletId });
    const balances = res.data?.tokenBalances ?? [];
    return balances.map((b) => ({
      tokenSymbol: b.token?.symbol ?? "UNKNOWN",
      tokenId: b.token?.id ?? "",
      amount: b.amount ?? "0",
    }));
  } catch (err) {
    throw new CircleApiError(
      `Failed to fetch wallet balance for ${circleWalletId}`,
      err
    );
  }
}

/** Convenience: USDC balance only, as a decimal string ("0" if the wallet holds none yet). */
export async function getUsdcBalance(circleWalletId: string): Promise<string> {
  const balances = await getWalletBalance(circleWalletId);
  const usdc = balances.find((b) => b.tokenSymbol === "USDC");
  return usdc?.amount ?? "0";
}

/**
 * Resolves the Circle tokenId for USDC on Arc. Set CIRCLE_USDC_TOKEN_ID in
 * env once you know it (visible in the Circle console or in any
 * getWalletTokenBalance response) to skip this lookup on every send.
 */
async function resolveUsdcTokenId(circleWalletId: string): Promise<string> {
  const configured = getEnv().CIRCLE_USDC_TOKEN_ID;
  if (configured) return configured;

  const balances = await getWalletBalance(circleWalletId);
  const usdc = balances.find((b) => b.tokenSymbol === "USDC");
  if (!usdc?.tokenId) {
    throw new CircleApiError(
      `Could not resolve USDC tokenId for wallet ${circleWalletId} — set CIRCLE_USDC_TOKEN_ID explicitly.`
    );
  }
  return usdc.tokenId;
}

export interface SendResult {
  /** The submitted transaction's identifier. Since the App Kit migration
   * (see lib/circle/appKit.ts) this is the onchain txHash, not a Circle-
   * internal transaction id — App Kit doesn't expose the latter. Kept as
   * `circleTransactionId` in this interface (rather than renamed) only
   * because the OnchainTransaction.circleTransactionId column callers
   * write it into predates this migration; the column now holds a
   * provider transaction identifier in the broader sense, txHash being
   * this provider's version of that. */
  circleTransactionId: string;
  state: string;
  explorerUrl?: string;
}

/**
 * Sends USDC from a Comparta-custodied wallet to an arbitrary Arc
 * address, via App Kit's Send capability (lib/circle/appKit.ts) — NOT a
 * raw Circle Developer-Controlled Wallets REST call anymore. `amount` is
 * a bigint in micro-USDC (smallest unit) — this function does the
 * decimal-string conversion App Kit expects, so callers never touch
 * float math on money.
 *
 * Takes the wallet's onchain `fromAddress` (Wallet.arcAddress), not its
 * Circle wallet id — App Kit's Send capability identifies the source
 * wallet by address, unlike the raw REST API this replaced, which used
 * Circle's internal walletId. See lib/transfers/send.ts for the one
 * caller this affects.
 *
 * Per lib/circle/appKit.ts's module docstring: App Kit's kit.send()
 * resolves synchronously to a final state, unlike the old REST flow's
 * PENDING-then-poll lifecycle. This function surfaces that result
 * as-is — it does NOT write any LedgerEntry rows or assume a particular
 * downstream persistence model; see lib/transfers/send.ts for that.
 */
export async function sendTransaction(
  fromAddress: string,
  toAddress: string,
  amount: bigint,
  chain: import("@/app/generated/prisma/client").Chain,
  idempotencyKey: string = randomUUID()
): Promise<SendResult> {
  if (amount <= 0n) {
    throw new CircleApiError("sendTransaction: amount must be positive");
  }

  try {
    const result = await sendViaAppKit(fromAddress, toAddress, amount, chain);
    return {
      circleTransactionId: result.txHash,
      state: result.state,
      explorerUrl: result.explorerUrl,
    };
  } catch (err) {
    if (err instanceof AppKitSendError) {
      throw new CircleApiError(
        `Failed to send ${toDecimalString(amount)} USDC from ${fromAddress} to ${toAddress}`,
        err.cause ?? err
      );
    }
    throw err;
  }
}

export interface TransactionStatus {
  id: string;
  state: string; // INITIATED | PENDING_RISK_SCREENING | QUEUED | SENT | CONFIRMED | COMPLETE | FAILED | CANCELLED | DENIED
  txHash?: string;
  amounts?: string[];
}

export async function getTransactionStatus(
  circleTransactionId: string
): Promise<TransactionStatus> {
  const client = getCircleClient();
  try {
    const res = await client.getTransaction({ id: circleTransactionId });
    const tx = res.data?.transaction;
    if (!tx) {
      throw new CircleApiError(`Circle getTransaction returned no data for ${circleTransactionId}`);
    }
    return {
      id: tx.id ?? circleTransactionId,
      state: tx.state ?? "UNKNOWN",
      txHash: tx.txHash ?? undefined,
      amounts: tx.amounts ?? undefined,
    };
  } catch (err) {
    throw new CircleApiError(
      `Failed to fetch transaction status for ${circleTransactionId}`,
      err
    );
  }
}