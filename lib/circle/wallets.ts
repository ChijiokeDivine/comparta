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
  const configured = process.env.CIRCLE_USDC_TOKEN_ID;
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
  circleTransactionId: string;
  state: string;
}

/**
 * Sends USDC from a Comparta-custodied wallet to an arbitrary Arc address.
 * `amount` is a bigint in micro-USDC (smallest unit) — this function does
 * the decimal-string conversion Circle's API expects, so callers never
 * touch float math on money.
 *
 * This function only submits the transaction to Circle; it does NOT write
 * any LedgerEntry rows. Callers (API routes / jobs) are responsible for
 * calling lib/ledger/engine after a successful submission, keyed off the
 * returned circleTransactionId, and reconciling final status via webhook
 * or getTransactionStatus.
 */
export async function sendTransaction(
  circleWalletId: string,
  toAddress: string,
  amount: bigint,
  idempotencyKey: string = randomUUID()
): Promise<SendResult> {
  if (amount <= 0n) {
    throw new CircleApiError("sendTransaction: amount must be positive");
  }

  const client = getCircleClient();
  const tokenId = await resolveUsdcTokenId(circleWalletId);

  try {
    const res = await client.createTransaction({
      walletId: circleWalletId,
      tokenId,
      destinationAddress: toAddress,
      amount: [toDecimalString(amount)],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey,
    });

    const id = res.data?.id;
    if (!id) {
      throw new CircleApiError("Circle createTransaction returned no transaction id");
    }

    return { circleTransactionId: id, state: res.data?.state ?? "INITIATED" };
  } catch (err) {
    throw new CircleApiError(
      `Failed to send ${toDecimalString(amount)} USDC from ${circleWalletId} to ${toAddress}`,
      err
    );
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
