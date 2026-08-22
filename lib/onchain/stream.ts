// lib/onchain/stream.ts
//
// Server primitives for StreamModule.
//
// Typechain coverage used:
//   - `StreamModule.StreamStruct/Output` via re-export from ./types
//   - `createStream(agreementId, recipient, start, end, cliff)` (5-tuple)
//   - `claim`, `cancelStream`, `claimableAmount`, `accruedAmount(agreementId, ts)`
//   - `onActivate` / `onTerminate` are called by AgreementCore, not by app code.

import type { AddressLike, BigNumberish, BytesLike } from "ethers";
import type { ContractTransactionResponse } from "ethers";

import {
  getStreamModule,
  getOperatorSigner,
  getProvider,
} from "./client";

import type {
  CreateStreamParams,
  CreateAgreementParams,
  StreamStructOutput,
} from "./types";

import { createAgreement } from "./agreements";

// --- Write primitives --------------------------------------------------

/**
 * Attach a stream config to an existing agreement (status must be Created
 * or Funded). `cliff` defaults to `startTime` (no cliff). Once the
 * agreement is funded + activated, streams begin ticking.
 */
export async function createStream(
  params: CreateStreamParams
): Promise<ContractTransactionResponse> {
  const mod = getStreamModule(getOperatorSigner());
  const cliff = params.cliff ?? params.startTime;
  return await mod.createStream(
    params.agreementId,
    params.recipient,
    params.startTime,
    params.endTime,
    cliff
  );
}

/** Recipient claims accrued-but-unclaimed funds. Pure time math on-chain. */
export function claimStream(
  agreementId: BytesLike
): Promise<ContractTransactionResponse> {
  return getStreamModule(getOperatorSigner()).claim(agreementId);
}

/**
 * Authorized cancel. Accrued-but-unclaimed goes to the recipient,
 * unaccrued remainder is refunded to the payer via Core.cancelAgreement.
 *
 * Precondition: StreamModule address is registered in the agreement's
 * authorized set (it calls Core.cancelAgreement internally). The
 * `createStreamAgreement()` helper handles this.
 */
export function cancelStream(
  agreementId: BytesLike
): Promise<ContractTransactionResponse> {
  return getStreamModule(getOperatorSigner()).cancelStream(agreementId);
}

// --- Read primitives ---------------------------------------------------

export function getStream(
  agreementId: BytesLike
): Promise<StreamStructOutput> {
  return getStreamModule(getProvider()).getStream(agreementId);
}

/** Currently claimable (= accrued - claimed). */
export function claimableAmount(
  agreementId: BytesLike
): Promise<bigint> {
  return getStreamModule(getProvider()).claimableAmount(agreementId);
}

/**
 * Accrued as of `timestamp` (unix seconds). For projections / dashboards
 * without needing a claim.
 */
export function accruedAmount(
  agreementId: BytesLike,
  timestamp: BigNumberish
): Promise<bigint> {
  return getStreamModule(getProvider()).accruedAmount(agreementId, timestamp);
}

// --- Off-chain stream math (mirrors contract formula) -----------------

/**
 * Pure TS mirror of the module's linear stream formula.
 * Same clamping rules: 0 before cliff, 0 before start, full after end,
 * integer division rounding down (fractional wei held for last second).
 *
 * Use this for UI progress bars / projections — avoids RPC calls.
 * If the stream was cancelled, pass `cancelledAt` so accrual stops there.
 */
export function computeAccrued(params: {
  deposited: bigint;
  startTime: bigint;
  endTime: bigint;
  cliff: bigint;
  nowTs: bigint;
  cancelledAt?: bigint | null;
}): bigint {
  const effectiveNow =
    params.cancelledAt != null && params.cancelledAt > 0n
      ? params.cancelledAt
      : params.nowTs;

  if (effectiveNow < params.cliff) return 0n;
  if (effectiveNow <= params.startTime) return 0n;
  const t = effectiveNow < params.endTime ? effectiveNow : params.endTime;
  const elapsed = t - params.startTime;
  const duration = params.endTime - params.startTime;
  if (duration <= 0n) return params.deposited;
  return (params.deposited * elapsed) / duration;
}

/**
 * Fraction [0, 1] of stream accrued. Uses fixed-point multiplication by
 * 1_000_000 to avoid float error during conversion.
 */
export function streamProgressFraction(params: {
  deposited: bigint;
  startTime: bigint;
  endTime: bigint;
  cliff: bigint;
  nowTs: bigint;
  cancelledAt?: bigint | null;
}): number {
  if (params.deposited === 0n) return 0;
  const accrued = computeAccrued(params);
  return Number((accrued * 1_000_000n) / params.deposited) / 1_000_000;
}

// --- Orchestration helpers --------------------------------------------

/**
 * One-shot helper: create the Core agreement with `STREAM_MODULE_ADDRESS`
 * pre-registered in `initialAuthorized` (required for the cancel-path
 * v1 caveat in §22), then immediately call `createStream`.
 * Returns both txs; follow up with `fundAgreement` + `activateAgreement`.
 */
export async function createStreamAgreement(
  params: Omit<CreateAgreementParams, "module"> &
    Omit<CreateStreamParams, "agreementId">
): Promise<{
  createTx: ContractTransactionResponse;
  streamTx: ContractTransactionResponse;
}> {
  const env = (await import("@/lib/env")).getEnv();
  const streamModuleAddr = env.STREAM_MODULE_ADDRESS;
  if (!streamModuleAddr) {
    throw new Error("STREAM_MODULE_ADDRESS not set — cannot create stream");
  }

  const initialAuthorized = Array.from(
    new Set([...(params.initialAuthorized ?? []), streamModuleAddr])
  );

  const createTx = await createAgreement({
    ...params,
    module: streamModuleAddr,
    initialAuthorized,
  });
  await createTx.wait(1);

  const streamTx = await createStream({
    agreementId: params.agreementId,
    recipient: params.recipient,
    startTime: params.startTime,
    endTime: params.endTime,
    cliff: params.cliff,
  });
  return { createTx, streamTx };
}

// --- USDC display helpers --------------------------------------------

export async function claimableAmountUsdc(
  agreementId: BytesLike
): Promise<string> {
  const raw = await claimableAmount(agreementId);
  const { toDecimalString } = await import("@/lib/circle/amount");
  return toDecimalString(raw);
}
