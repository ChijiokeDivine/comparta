// lib/onchain/types.ts
//
// Domain types built ON TOP of the generated typechain types in
// `types/typechain-types`.
//
// Design rules (per the user's instruction to lean on typechain first):
//   1. Struct inputs/outputs are re-exported from typechain with
//      readable aliases. Never re-declare the same field list.
//   2. Domain-only concepts (AgreementStatus enum, event name unions,
//      pure helper types) live here — they have no Solidity equivalent.
//   3. Conversion functions like `statusFromBigint` bridge typechain's
//      `bigint` status raw value to the TS enum.
//
// Re-exporting the contract interface types here means callers can do:
//   import type { Agreement, Condition, Stream } from "@/lib/onchain/types";
// instead of reaching into `types/typechain-types/contracts/src/...`.

import type { BytesLike, BigNumberish, AddressLike } from "ethers";

// --- Contract struct re-exports from typechain ------------------------

import type { AgreementCore } from "@/types/typechain-types/contracts/src/AgreementCore";
import type { ConditionalPaymentModule } from "@/types/typechain-types/contracts/src/modules/ConditionalPaymentModule";
import type { StreamModule } from "@/types/typechain-types/contracts/src/modules/StreamModule";

/** Typechain tuple (CreateParamsStruct input) for AgreementCore.createAgreement */
export type CreateAgreementStruct = AgreementCore.CreateParamsStruct;
export type CreateAgreementStructOutput = AgreementCore.CreateParamsStructOutput;

/** Typechain full Agreement struct as returned by AgreementCore.getAgreement */
export type AgreementStruct = AgreementCore.AgreementStruct;
export type AgreementStructOutput = AgreementCore.AgreementStructOutput;

/** Typechain Condition struct as returned by ConditionalPaymentModule.getCondition */
export type ConditionStruct = ConditionalPaymentModule.ConditionStruct;
export type ConditionStructOutput = ConditionalPaymentModule.ConditionStructOutput;

/** Typechain Stream struct as returned by StreamModule.getStream */
export type StreamStruct = StreamModule.StreamStruct;
export type StreamStructOutput = StreamModule.StreamStructOutput;

// --- Domain-only types -------------------------------------------------

export enum AgreementStatus {
  Created = 0,
  Funded = 1,
  Active = 2,
  Settled = 3,
  Cancelled = 4,
  Expired = 5,
}

export const AgreementStatusLabels: Record<AgreementStatus, string> = {
  [AgreementStatus.Created]: "Created",
  [AgreementStatus.Funded]: "Funded",
  [AgreementStatus.Active]: "Active",
  [AgreementStatus.Settled]: "Settled",
  [AgreementStatus.Cancelled]: "Cancelled",
  [AgreementStatus.Expired]: "Expired",
};

export function statusFromBigint(raw: bigint): AgreementStatus {
  if (
    raw < BigInt(AgreementStatus.Created) ||
    raw > BigInt(AgreementStatus.Expired)
  ) {
    throw new RangeError(
      `Unknown AgreementStatus raw value: ${raw.toString()}`
    );
  }
  return Number(raw) as AgreementStatus;
}

// Well-known `IAgreementModule.moduleType()` return values.
export const MODULE_TYPE_CONDITIONAL = "CONDITIONAL_PAYMENT";
export const MODULE_TYPE_STREAM = "STREAM";

// --- Input shapes (domain-specific wrappers around typechain params) --

export interface CreateAgreementParams extends CreateAgreementStruct {
  initialAuthorized?: AddressLike[];
}

export interface RegisterConditionInput {
  conditionId: BytesLike;
  amount: BigNumberish;
  beneficiaries: AddressLike[];
  earliestRelease?: BigNumberish;
  deadline?: BigNumberish;
}

export interface CreateStreamParams {
  agreementId: BytesLike;
  recipient: AddressLike;
  startTime: BigNumberish;
  endTime: BigNumberish;
  cliff?: BigNumberish;
}

// --- EIP-712 payloads --------------------------------------------------

export interface AuthorizeConditionSignaturePayload {
  agreementId: BytesLike;
  conditionId: BytesLike;
  nonce: BigNumberish;
  deadline: BigNumberish;
}

// --- Event envelope (used by future indexer) --------------------------

export type ProtocolEventName =
  | "AgreementCreated"
  | "AgreementFunded"
  | "AgreementActivated"
  | "AgreementSettled"
  | "AgreementCancelled"
  | "AgreementExpired"
  | "AuthorizationGranted"
  | "AuthorizationRevoked"
  | "PaymentReleased"
  | "RefundIssued"
  | "ConditionRegistered"
  | "ConditionAuthorized"
  | "ConditionReleased"
  | "StreamCreated"
  | "StreamClaimed"
  | "StreamCancelled";

export interface OnchainEventEnvelope<TPayload = unknown> {
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  name: ProtocolEventName;
  agreementId: string;
  payload: TPayload;
}

// --- Convenience: domain-friendly "flattened" read types ---------------
//
// These are copies of the typechain OutputStructs but with the enum
// already decoded and explicit string/bigint typing. They're optional
// sugar; callers that want raw typechain fidelity can use the *Output
// types above directly.

export type OnchainAgreement = Omit<
  AgreementStructOutput,
  "status"
> & {
  status: AgreementStatus;
};

export type OnchainCondition = ConditionStructOutput;
export type OnchainStream = StreamStructOutput;

/**
 * Convert a typechain AgreementStructOutput to the domain-friendly
 * variant with the status enum decoded.
 */
export function toOnchainAgreement(raw: AgreementStructOutput): OnchainAgreement {
  const { status: _status, ...rest } = raw;
  return {
    ...rest,
    status: statusFromBigint(raw.status),
  };
}
