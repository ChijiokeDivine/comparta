/**
 * lib/onchain/agreements.ts
 *
 * Server-side primitives for the on-chain financial layer.
 *
 * Design:
 *  - Does NOT replace Circle wallet / App-Kit send paths.
 *  - Uses viem for contract reads/writes against Arc.
 *  - Records every submission with an explicit status machine
 *    (intent → submitted → pending → confirmed | failed | reverted).
 *  - On-chain events + confirmed state are the source of truth for
 *    agreement balances; the internal ledger receives *derived* entries
 *    only after confirmation (same posture as existing OnchainTransaction).
 *
 * Environment:
 *  - ARC_TESTNET_RPC_URL
 *  - AGREEMENT_CORE_ADDRESS
 *  - CONDITIONAL_MODULE_ADDRESS
 *  - STREAM_MODULE_ADDRESS
 *  - USDC_ADDRESS (or CIRCLE_USDC_TOKEN_ID mapped to address)
 */

import { createPublicClient, createWalletClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  AgreementTerms,
  ConditionalTerms,
  StreamTerms,
  AgreementView,
  StreamView,
  OnchainActionRecord,
  AgreementStatus,
} from "./types";

// ─── ABIs (minimal; full ABIs exported from contracts/out after compile) ───

const AGREEMENT_CORE_ABI = [
  {
    type: "function",
    name: "createAgreement",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "agreementId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "token", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
          { name: "metadataHash", type: "bytes32" },
          { name: "module", type: "address" },
        ],
      },
      { name: "initialAuthorized", type: "address[]" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fundAgreement",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "activateAgreement",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelAgreement",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getAgreement",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agreementId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "token", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "deposited", type: "uint256" },
          { name: "released", type: "uint256" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "metadataHash", type: "bytes32" },
          { name: "module", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "activatedAt", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "remaining",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const STREAM_MODULE_ABI = [
  {
    type: "function",
    name: "createStream",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "cliff", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claim",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelStream",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimableAmount",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getStream",
    inputs: [{ name: "agreementId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agreementId", type: "bytes32" },
          { name: "sender", type: "address" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "deposited", type: "uint256" },
          { name: "claimed", type: "uint256" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
          { name: "cliff", type: "uint64" },
          { name: "cancelled", type: "bool" },
          { name: "cancelledAt", type: "uint64" },
          { name: "initialized", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

const CONDITIONAL_MODULE_ABI = [
  {
    type: "function",
    name: "registerConditions",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "conditionIds", type: "bytes32[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "beneficiariesPerCondition", type: "address[][]" },
      { name: "earliestReleases", type: "uint64[]" },
      { name: "deadlines", type: "uint64[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "authorizeCondition",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "releaseCondition",
    inputs: [
      { name: "agreementId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ─── Config ───────────────────────────────────────────────────────────────

function getConfig() {
  const rpc = process.env.ARC_TESTNET_RPC_URL;
  const core = process.env.AGREEMENT_CORE_ADDRESS as Address | undefined;
  const conditional = process.env.CONDITIONAL_MODULE_ADDRESS as Address | undefined;
  const stream = process.env.STREAM_MODULE_ADDRESS as Address | undefined;
  const usdc = process.env.USDC_ADDRESS as Address | undefined;
  const pk = process.env.ONCHAIN_OPERATOR_PRIVATE_KEY as Hex | undefined;

  if (!rpc || !core) {
    throw new Error(
      "Missing ARC_TESTNET_RPC_URL or AGREEMENT_CORE_ADDRESS – on-chain layer not configured"
    );
  }

  return { rpc, core, conditional, stream, usdc, pk };
}

function getPublicClient() {
  const { rpc } = getConfig();
  return createPublicClient({
    transport: http(rpc),
  });
}

function getWalletClient() {
  const { rpc, pk } = getConfig();
  if (!pk) {
    throw new Error("ONCHAIN_OPERATOR_PRIVATE_KEY required for write operations");
  }
  const account = privateKeyToAccount(pk);
  return createWalletClient({
    account,
    transport: http(rpc),
  });
}

const STATUS_MAP: AgreementStatus[] = [
  "None",
  "Created",
  "Funded",
  "Active",
  "Settled",
  "Cancelled",
  "Expired",
];

// ─── Public API (matches the conceptual DX from the architecture) ─────────

/**
 * Create a generalized agreement on-chain.
 * Returns the agreementId (echoed) and the submitted tx hash.
 * Status is "submitted"; confirmation is handled by event indexing / polling.
 */
export async function createAgreement(
  terms: AgreementTerms
): Promise<{ agreementId: `0x${string}`; txHash: `0x${string}` }> {
  const { core } = getConfig();
  const wallet = getWalletClient();
  const publicClient = getPublicClient();

  const hash = await wallet.writeContract({
    address: core,
    abi: AGREEMENT_CORE_ABI,
    functionName: "createAgreement",
    args: [
      {
        agreementId: terms.agreementId,
        payer: terms.payer,
        token: terms.token,
        principal: terms.principal,
        startTime: BigInt(terms.startTime),
        endTime: BigInt(terms.endTime),
        metadataHash: terms.metadataHash,
        module: (terms.module ??
          "0x0000000000000000000000000000000000000000") as `0x${string}`,
      },
      terms.initialAuthorized ?? [],
    ],
    chain: null,
  });

  return { agreementId: terms.agreementId, txHash: hash };
}

export async function fundAgreement(
  agreementId: `0x${string}`,
  amount: bigint
): Promise<{ txHash: `0x${string}` }> {
  const { core } = getConfig();
  const wallet = getWalletClient();

  // Caller must have already approved the Core for `amount` of the token.
  const hash = await wallet.writeContract({
    address: core,
    abi: AGREEMENT_CORE_ABI,
    functionName: "fundAgreement",
    args: [agreementId, amount],
    chain: null,
  });

  return { txHash: hash };
}

export async function activateAgreement(
  agreementId: `0x${string}`
): Promise<{ txHash: `0x${string}` }> {
  const { core } = getConfig();
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: core,
    abi: AGREEMENT_CORE_ABI,
    functionName: "activateAgreement",
    args: [agreementId],
    chain: null,
  });

  return { txHash: hash };
}

export async function getAgreement(
  agreementId: `0x${string}`
): Promise<AgreementView | null> {
  const { core } = getConfig();
  const publicClient = getPublicClient();

  const raw = await publicClient.readContract({
    address: core,
    abi: AGREEMENT_CORE_ABI,
    functionName: "getAgreement",
    args: [agreementId],
  });

  if (raw.status === 0) return null;

  return {
    agreementId: raw.agreementId,
    payer: raw.payer,
    token: raw.token,
    principal: raw.principal,
    deposited: raw.deposited,
    released: raw.released,
    startTime: Number(raw.startTime),
    endTime: Number(raw.endTime),
    status: STATUS_MAP[raw.status] ?? "None",
    metadataHash: raw.metadataHash,
    module: raw.module,
    createdAt: Number(raw.createdAt),
    activatedAt: Number(raw.activatedAt),
  };
}

export async function registerConditions(
  agreementId: `0x${string}`,
  terms: ConditionalTerms
): Promise<{ txHash: `0x${string}` }> {
  const { conditional } = getConfig();
  if (!conditional) throw new Error("CONDITIONAL_MODULE_ADDRESS not set");
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: conditional,
    abi: CONDITIONAL_MODULE_ABI,
    functionName: "registerConditions",
    args: [
      agreementId,
      terms.conditionIds,
      terms.amounts,
      terms.beneficiariesPerCondition,
      terms.earliestReleases.map(BigInt),
      terms.deadlines.map(BigInt),
    ],
    chain: null,
  });

  return { txHash: hash };
}

export async function authorizeCondition(
  agreementId: `0x${string}`,
  conditionId: `0x${string}`
): Promise<{ txHash: `0x${string}` }> {
  const { conditional } = getConfig();
  if (!conditional) throw new Error("CONDITIONAL_MODULE_ADDRESS not set");
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: conditional,
    abi: CONDITIONAL_MODULE_ABI,
    functionName: "authorizeCondition",
    args: [agreementId, conditionId],
    chain: null,
  });

  return { txHash: hash };
}

export async function releaseCondition(
  agreementId: `0x${string}`,
  conditionId: `0x${string}`
): Promise<{ txHash: `0x${string}` }> {
  const { conditional } = getConfig();
  if (!conditional) throw new Error("CONDITIONAL_MODULE_ADDRESS not set");
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: conditional,
    abi: CONDITIONAL_MODULE_ABI,
    functionName: "releaseCondition",
    args: [agreementId, conditionId],
    chain: null,
  });

  return { txHash: hash };
}

export async function createStream(
  agreementId: `0x${string}`,
  terms: StreamTerms
): Promise<{ txHash: `0x${string}` }> {
  const { stream } = getConfig();
  if (!stream) throw new Error("STREAM_MODULE_ADDRESS not set");
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: stream,
    abi: STREAM_MODULE_ABI,
    functionName: "createStream",
    args: [
      agreementId,
      terms.recipient,
      BigInt(terms.startTime),
      BigInt(terms.endTime),
      BigInt(terms.cliff),
    ],
    chain: null,
  });

  return { txHash: hash };
}

export async function claimStream(
  agreementId: `0x${string}`
): Promise<{ txHash: `0x${string}` }> {
  const { stream } = getConfig();
  if (!stream) throw new Error("STREAM_MODULE_ADDRESS not set");
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: stream,
    abi: STREAM_MODULE_ABI,
    functionName: "claim",
    args: [agreementId],
    chain: null,
  });

  return { txHash: hash };
}

export async function cancelStream(
  agreementId: `0x${string}`
): Promise<{ txHash: `0x${string}` }> {
  const { stream } = getConfig();
  if (!stream) throw new Error("STREAM_MODULE_ADDRESS not set");
  const wallet = getWalletClient();

  const hash = await wallet.writeContract({
    address: stream,
    abi: STREAM_MODULE_ABI,
    functionName: "cancelStream",
    args: [agreementId],
    chain: null,
  });

  return { txHash: hash };
}

export async function getStreamView(
  agreementId: `0x${string}`
): Promise<StreamView | null> {
  const { stream } = getConfig();
  if (!stream) throw new Error("STREAM_MODULE_ADDRESS not set");
  const publicClient = getPublicClient();

  const raw = await publicClient.readContract({
    address: stream,
    abi: STREAM_MODULE_ABI,
    functionName: "getStream",
    args: [agreementId],
  });

  if (!raw.initialized) return null;

  const claimable = await publicClient.readContract({
    address: stream,
    abi: STREAM_MODULE_ABI,
    functionName: "claimableAmount",
    args: [agreementId],
  });

  return {
    agreementId: raw.agreementId,
    sender: raw.sender,
    recipient: raw.recipient,
    token: raw.token,
    deposited: raw.deposited,
    claimed: raw.claimed,
    startTime: Number(raw.startTime),
    endTime: Number(raw.endTime),
    cliff: Number(raw.cliff),
    cancelled: raw.cancelled,
    cancelledAt: Number(raw.cancelledAt),
    claimable,
  };
}
