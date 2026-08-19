/**
 * lib/onchain/types.ts
 *
 * TypeScript types mirroring the on-chain AgreementCore + modules.
 * These are the off-chain representations used by services, DB records,
 * and API responses. On-chain state remains the source of truth for
 * balances, claimed amounts, and agreement status.
 */

export type AgreementStatus =
  | "None"
  | "Created"
  | "Funded"
  | "Active"
  | "Settled"
  | "Cancelled"
  | "Expired";

export type OnchainActionStatus =
  | "intent"
  | "submitted"
  | "pending"
  | "confirmed"
  | "failed"
  | "reverted";

export interface AgreementTerms {
  agreementId: `0x${string}`;
  payer: `0x${string}`;
  token: `0x${string}`;
  principal: bigint; // micro-USDC
  startTime: number; // unix seconds
  endTime: number;
  metadataHash: `0x${string}`;
  module: `0x${string}` | null;
  initialAuthorized?: `0x${string}`[];
}

export interface ConditionalTerms {
  conditionIds: `0x${string}`[];
  amounts: bigint[];
  beneficiariesPerCondition: `0x${string}`[][];
  earliestReleases: number[];
  deadlines: number[];
}

export interface StreamTerms {
  recipient: `0x${string}`;
  startTime: number;
  endTime: number;
  cliff: number; // seconds
}

export interface AgreementView {
  agreementId: `0x${string}`;
  payer: `0x${string}`;
  token: `0x${string}`;
  principal: bigint;
  deposited: bigint;
  released: bigint;
  startTime: number;
  endTime: number;
  status: AgreementStatus;
  metadataHash: `0x${string}`;
  module: `0x${string}`;
  createdAt: number;
  activatedAt: number;
}

export interface StreamView {
  agreementId: `0x${string}`;
  sender: `0x${string}`;
  recipient: `0x${string}`;
  token: `0x${string}`;
  deposited: bigint;
  claimed: bigint;
  startTime: number;
  endTime: number;
  cliff: number;
  cancelled: boolean;
  cancelledAt: number;
  accrued?: bigint;
  claimable?: bigint;
}

export interface OnchainActionRecord {
  id: string;
  agreementId: `0x${string}`;
  action:
    | "createAgreement"
    | "fundAgreement"
    | "activateAgreement"
    | "authorizeCondition"
    | "releaseCondition"
    | "createStream"
    | "claimStream"
    | "cancelStream"
    | "cancelAgreement";
  status: OnchainActionStatus;
  txHash?: `0x${string}`;
  error?: string;
  createdAt: Date;
  confirmedAt?: Date;
}
