// lib/onchain/conditional.ts
//
// Server primitives for ConditionalPaymentModule.
//
// Typechain coverage used:
//   - `ConditionalPaymentModule.ConditionStruct/Output` via re-export from ./types
//   - All write methods return `ContractTransactionResponse` (typechain default)
//   - `eip712Domain()` for signing; `AUTHORIZE_CONDITION_TYPEHASH` for diagnostics
//   - `registerConditions()` uses the 5-parallel-array Solidity signature
//     (ids, amounts, beneficiaries per cond, earliest releases, deadlines)

import type {
  AddressLike,
  BigNumberish,
  BytesLike,
  Signer,
  TypedDataDomain,
} from "ethers";
import type { ContractTransactionResponse } from "ethers";
import { hexlify, getBytes } from "ethers";

import {
  getConditionalModule,
  getOperatorSigner,
  getProvider,
} from "./client";
import { previewNextNonce } from "./agreements";

import type {
  AuthorizeConditionSignaturePayload,
  ConditionStructOutput,
  RegisterConditionInput,
} from "./types";

// --- EIP-712 domain / typehash ----------------------------------------

const AUTHORIZE_CONDITION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  AuthorizeCondition: [
    { name: "agreementId", type: "bytes32" },
    { name: "conditionId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

let cachedDomain: TypedDataDomain | null = null;
export async function getConditionalEip712Domain(): Promise<TypedDataDomain> {
  if (cachedDomain) return cachedDomain;
  const mod = getConditionalModule(getProvider());
  const raw = await mod.eip712Domain();
  cachedDomain = {
    name: raw.name,
    version: raw.version,
    chainId: Number(raw.chainId),
    verifyingContract: raw.verifyingContract,
    salt:
      raw.salt !== "0x" &&
      raw.salt !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
        ? raw.salt
        : undefined,
  };
  return cachedDomain;
}

export function getAuthorizeConditionTypehash(): Promise<string> {
  return getConditionalModule(getProvider()).AUTHORIZE_CONDITION_TYPEHASH();
}

// --- Signature builder -------------------------------------------------

/**
 * Produce an EIP-712 `AuthorizeCondition` signature using `signer`.
 * Defaults: deadline = now + 24h; nonce = atomically bumped via Core.useNonce.
 * Returns `{ signature, nonce, deadline }` — pass directly to
 * `authorizeConditionWithSignature` (any submitter).
 */
export async function signAuthorizeCondition(
  signer: Signer,
  payload: Omit<AuthorizeConditionSignaturePayload, "nonce" | "deadline"> & {
    nonce?: BigNumberish;
    deadline?: BigNumberish;
  }
): Promise<{ signature: string; nonce: bigint; deadline: bigint }> {
  const defaultDeadline = BigInt(
    Math.floor(Date.now() / 1000) + 60 * 60 * 24
  );
  const deadline =
    payload.deadline != null ? BigInt(payload.deadline) : defaultDeadline;

  let nonce: bigint;
  if (payload.nonce != null) {
    nonce = BigInt(payload.nonce);
  } else {
    const signerAddr = await signer.getAddress();
    nonce = await previewNextNonce(payload.agreementId, signerAddr);
  }

  const domain = await getConditionalEip712Domain();
  const message = {
    agreementId: hexlify(padBytes32(payload.agreementId)),
    conditionId: hexlify(padBytes32(payload.conditionId)),
    nonce,
    deadline,
  };
  const signature = await signer.signTypedData(
    domain,
    AUTHORIZE_CONDITION_TYPES,
    message
  );
  return { signature, nonce, deadline };
}

function padBytes32(v: BytesLike): Uint8Array {
  const b = getBytes(v);
  if (b.length === 32) return b;
  if (b.length < 32) {
    const out = new Uint8Array(32);
    out.set(b, 32 - b.length);
    return out;
  }
  return b.slice(0, 32);
}

// --- Write primitives --------------------------------------------------

/**
 * Batch-register conditions for an agreement (must be Created / Funded).
 * Signature: `registerConditions(agreementId, conditionIds[], amounts[],
 * beneficiariesPerCondition[][], earliestReleases[], deadlines[])`.
 * Authorized caller only.
 */
export async function registerConditions(
  agreementId: BytesLike,
  conditions: RegisterConditionInput[]
): Promise<ContractTransactionResponse> {
  if (conditions.length === 0) {
    throw new RangeError("registerConditions requires at least one condition");
  }
  const mod = getConditionalModule(getOperatorSigner());
  const conditionIds: BytesLike[] = [];
  const amounts: BigNumberish[] = [];
  const beneficiariesPerCondition: AddressLike[][] = [];
  const earliestReleases: BigNumberish[] = [];
  const deadlines: BigNumberish[] = [];

  for (const c of conditions) {
    conditionIds.push(c.conditionId);
    amounts.push(c.amount);
    beneficiariesPerCondition.push(c.beneficiaries);
    earliestReleases.push(c.earliestRelease ?? 0n);
    deadlines.push(c.deadline ?? 0n);
  }

  return await mod.registerConditions(
    agreementId,
    conditionIds,
    amounts,
    beneficiariesPerCondition,
    earliestReleases,
    deadlines
  );
}

/** Direct on-chain authorization by the caller (msg.sender). */
export function authorizeCondition(
  agreementId: BytesLike,
  conditionId: BytesLike
): Promise<ContractTransactionResponse> {
  return getConditionalModule(getOperatorSigner()).authorizeCondition(
    agreementId,
    conditionId
  );
}

/** Submit an EIP-712 signature; authorizing address is recovered on-chain. */
export function authorizeConditionWithSignature(
  agreementId: BytesLike,
  conditionId: BytesLike,
  nonce: BigNumberish,
  deadline: BigNumberish,
  signature: BytesLike
): Promise<ContractTransactionResponse> {
  return getConditionalModule(
    getOperatorSigner()
  ).authorizeConditionWithSignature(
    agreementId,
    conditionId,
    nonce,
    deadline,
    signature
  );
}

/**
 * Release funds for a condition (anyone can call after auth + time gates).
 * Equal split among beneficiaries per v1 (ONCHAIN_ARCHITECTURE.md §22).
 */
export function releaseCondition(
  agreementId: BytesLike,
  conditionId: BytesLike
): Promise<ContractTransactionResponse> {
  return getConditionalModule(getOperatorSigner()).releaseCondition(
    agreementId,
    conditionId
  );
}

// --- Read primitives ---------------------------------------------------

export function isConditionInitialized(
  agreementId: BytesLike
): Promise<boolean> {
  return getConditionalModule(getProvider()).isInitialized(agreementId);
}

export function getConditionIds(
  agreementId: BytesLike
): Promise<string[]> {
  return getConditionalModule(getProvider()).getConditionIds(agreementId);
}

export function getCondition(
  agreementId: BytesLike,
  conditionId: BytesLike
): Promise<ConditionStructOutput> {
  return getConditionalModule(getProvider()).getCondition(
    agreementId,
    conditionId
  );
}

export async function getAllConditions(
  agreementId: BytesLike
): Promise<ConditionStructOutput[]> {
  const ids = await getConditionIds(agreementId);
  return Promise.all(ids.map((id) => getCondition(agreementId, id)));
}

// --- Convenience: sign with backend operator -------------------------

export function operatorSignAuthorizeCondition(
  payload: Omit<AuthorizeConditionSignaturePayload, "nonce" | "deadline"> & {
    nonce?: BigNumberish;
    deadline?: BigNumberish;
  }
) {
  return signAuthorizeCondition(getOperatorSigner(), payload);
}
