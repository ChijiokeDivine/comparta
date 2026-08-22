// lib/onchain/agreements.ts
//
// Server primitives for AgreementCore.
//
// Every call goes through the typechain-generated contract interface:
//   - Input structs use `AgreementCore.CreateParamsStruct` (re-exported
//     from `./types` as `CreateAgreementStruct`).
//   - Write methods return `ContractTransactionResponse` (ethers/typechain
//     standard), callers `.wait(N)` for confirmations.
//   - Read methods return `AgreementCore.AgreementStructOutput` (or the
//     domain-wrapped `OnchainAgreement` variant via `getAgreement`).

import type { AddressLike, BigNumberish, BytesLike } from "ethers";
import type { ContractTransactionResponse } from "ethers";

import {
  getAgreementCore,
  getOperatorSigner,
  getProvider,
  getUsdcToken,
} from "./client";

import type {
  CreateAgreementParams,
  OnchainAgreement,
} from "./types";

import { toOnchainAgreement } from "./types";
import { toSmallestUnit } from "@/lib/circle/amount";

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// --- Write primitives --------------------------------------------------

/**
 * Create a new agreement. `params.agreementId` should be deterministic
 * (e.g. keccak256(orgId, invoiceId, salt)) so Comparta can correlate
 * before the tx is confirmed. Payer is always implicitly authorized;
 * additional actors may be passed via `params.initialAuthorized`.
 *
 * Signature matches `AgreementCore.createAgreement(p, initialAuthorized[])`.
 */
export async function createAgreement(
  params: CreateAgreementParams
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return await core.createAgreement(
    {
      agreementId: params.agreementId,
      payer: params.payer,
      token: params.token,
      principal: params.principal,
      startTime: params.startTime,
      endTime: params.endTime,
      metadataHash: params.metadataHash,
      module: params.module,
    },
    params.initialAuthorized ?? []
  );
}

/**
 * Deposit `amount` tokens into `agreementId`. Pre-condition: the source
 * (operator wallet or Circle wallet) has already approved AgreementCore
 * for at least `amount` of the agreement token.
 */
export async function fundAgreement(
  agreementId: BytesLike,
  amount: BigNumberish
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return await core.fundAgreement(agreementId, amount);
}

/**
 * Two-step convenience: approve AgreementCore to spend `amount` from the
 * operator wallet, wait 1 confirmation, then call fundAgreement.
 * Returns both tx hashes. Production flows should use Circle contract
 * interaction instead of raw operator approvals.
 */
export async function approveAndFundAgreement(
  agreementId: BytesLike,
  amount: BigNumberish,
  tokenAddress?: string
): Promise<{ approveHash: string; fundTx: ContractTransactionResponse }> {
  const env = (await import("@/lib/env")).getEnv();
  const coreAddr = env.AGREEMENT_CORE_ADDRESS;
  if (!coreAddr) throw new Error("AGREEMENT_CORE_ADDRESS not set");

  const token = getUsdcToken(tokenAddress, getOperatorSigner());
  const approveTx = await token.approve(coreAddr, amount);
  await approveTx.wait(1);

  const fundTx = await fundAgreement(agreementId, amount);
  return { approveHash: approveTx.hash, fundTx };
}

/**
 * Transition Funded → Active. Fires the module's `onActivate` hook.
 * Requires block.timestamp >= startTime and deposited >= principal.
 */
export function activateAgreement(
  agreementId: BytesLike
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.activateAgreement(agreementId);
}

/** Explicit cancel. Remaining balance refunded to payer (RefundIssued). */
export function cancelAgreement(
  agreementId: BytesLike
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.cancelAgreement(agreementId);
}

/** Expire an Active agreement past endTime. Same refund semantics as cancel. */
export function expireAgreement(
  agreementId: BytesLike
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.expireAgreement(agreementId);
}

/**
 * Release `amount` to `beneficiary`. `conditionId` tags the release with
 * the triggering module condition (bytes32(0) for untagged releases).
 * Application code should prefer module-specific release helpers in
 * `conditional.ts` / `stream.ts` over calling this directly.
 */
export function releaseTo(
  agreementId: BytesLike,
  beneficiary: AddressLike,
  amount: BigNumberish,
  conditionId: BytesLike = ZERO_BYTES32
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.releaseTo(agreementId, beneficiary, amount, conditionId);
}

// --- Authorization -----------------------------------------------------

export function grantAuthorization(
  agreementId: BytesLike,
  actor: AddressLike
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.grantAuthorization(agreementId, actor);
}

export function revokeAuthorization(
  agreementId: BytesLike,
  actor: AddressLike
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.revokeAuthorization(agreementId, actor);
}

/**
 * Submit the state-changing `useNonce` call from the operator wallet
 * (bumps the per-(agreement, actor) nonce by 1) and returns the TX so
 * the caller can `.wait()` for confirmations.
 *
 * For signing flows that need the NEXT nonce value *before* submitting
 * the tx, use `nextNonce()` below — it previews the value that would be
 * returned WITHOUT a blockchain write. The contract's signature-verify
 * path (`authorizeConditionWithSignature`) calls `useNonce` internally,
 * so the preview is guaranteed to match on-chain unless someone races
 * the same actor.
 */
export function useNonce(
  agreementId: BytesLike,
  actor: AddressLike
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.useNonce(agreementId, actor);
}

/**
 * Preview the next nonce that will be assigned when `useNonce` is called
 * (or consumed inside `authorizeConditionWithSignature`). Use this for
 * EIP-712 signing off-chain; do NOT call `useNonce` separately in the
 * same flow (the signature submission handles consumption atomically).
 */
export async function previewNextNonce(
  agreementId: BytesLike,
  actor: AddressLike
): Promise<bigint> {
  return getNonce(agreementId, actor);
}

// --- Read primitives ---------------------------------------------------

/**
 * Fetch and return the agreement with its status enum already decoded.
 * For raw typechain output, call `getAgreementCore(getProvider()).getAgreement(id)`
 * directly.
 */
export async function getAgreement(
  agreementId: BytesLike
): Promise<OnchainAgreement> {
  const core = getAgreementCore(getProvider());
  const raw = await core.getAgreement(agreementId);
  return toOnchainAgreement(raw);
}

export function remaining(agreementId: BytesLike): Promise<bigint> {
  return getAgreementCore(getProvider()).remaining(agreementId);
}

export function isAuthorized(
  agreementId: BytesLike,
  actor: AddressLike
): Promise<boolean> {
  return getAgreementCore(getProvider()).isAuthorized(agreementId, actor);
}

export function getNonce(
  agreementId: BytesLike,
  actor: AddressLike
): Promise<bigint> {
  return getAgreementCore(getProvider()).getNonce(agreementId, actor);
}

export function isTokenAllowed(token: AddressLike): Promise<boolean> {
  return getAgreementCore(getProvider()).allowedTokens(token);
}

export function agreementCounter(): Promise<bigint> {
  return getAgreementCore(getProvider()).agreementCounter();
}

export function setAllowedToken(
  token: AddressLike,
  allowed: boolean
): Promise<ContractTransactionResponse> {
  const core = getAgreementCore(getOperatorSigner());
  return core.setAllowedToken(token, allowed);
}

// --- Currency helpers --------------------------------------------------

/** Human USDC decimal string ("12.50") → 6-decimal bigint for the EVM. */
export function usdc(decimalAmount: string): bigint {
  return toSmallestUnit(decimalAmount);
}

/** Remaining locked balance as a decimal USDC string. */
export async function remainingUsdc(
  agreementId: BytesLike
): Promise<string> {
  const raw = await remaining(agreementId);
  const { toDecimalString } = await import("@/lib/circle/amount");
  return toDecimalString(raw);
}
