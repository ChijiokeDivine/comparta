// lib/onchain-agreements/service.ts
//
// Orchestration layer for the protocol mirror tables + onchain contract
// writes. Every "write operation" (create, fund, activate, …) here does
// THREE things atomically:
//   1. Validate preconditions (org/user/auth, product references exist)
//   2. Submit the onchain transaction via lib/onchain/* primitives
//   3. Persist the mirror row + action log in the DB with status PENDING
//      so the UI can poll without waiting for a block confirmation.
//
// Finalization (PENDING → CONFIRMED / FAILED, deposited/released/
// authorized/released flags updated) is the job of a future event-indexer
// worker (ONCHAIN_ARCHITECTURE.md §20) that subscribes to event logs and
// upserts rows — never handled inline here, since it would block the API
// response on block confirmations.

import { randomBytes } from "crypto";
import { hexlify, keccak256, toUtf8Bytes } from "ethers";
import type { AddressLike, BigNumberish, BytesLike } from "ethers";

import type {
  OnchainAgreementStatus,
  OnchainAgreementModule,
  OnchainProtocolAction,
  Prisma,
} from "@/app/generated/prisma/client";
import type { Prisma as PrismaNs } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

type TxClient = PrismaNs.TransactionClient;

import {
  createAgreement,
  fundAgreement,
  activateAgreement,
  cancelAgreement,
  expireAgreement,
  releaseTo,
  getAgreement as onchainGetAgreement,
  usdc,
  previewNextNonce,
  grantAuthorization,
  revokeAuthorization,
  approveAndFundAgreement,
} from "@/lib/onchain/agreements";

import {
  registerConditions as onchainRegisterConditions,
  authorizeCondition,
  releaseCondition,
  operatorSignAuthorizeCondition,
  getConditionIds as onchainGetConditionIds,
  getCondition as onchainGetCondition,
  getAllConditions,
} from "@/lib/onchain/conditional";

import {
  createStream as onchainCreateStream,
  createStreamAgreement,
  claimStream,
  cancelStream as onchainCancelStream,
  getStream as onchainGetStream,
  claimableAmount,
} from "@/lib/onchain/stream";

import {
  getConditionalModule,
  getOperatorAddress,
  getStreamModule,
  isOnchainConfigured,
  OnchainNotConfiguredError,
} from "@/lib/onchain";
import { getEnv } from "@/lib/env";
import type { RegisterConditionInput, CreateStreamParams } from "@/lib/onchain/types";

export class ProtocolNotConfiguredError extends Error {}
export class AgreementNotFoundError extends Error {}
export class ConditionNotFoundError extends Error {}
export class AgreementStatusError extends Error {
  constructor(
    msg: string,
    public readonly current: OnchainAgreementStatus,
    public readonly expected: string[]
  ) {
    super(msg);
  }
}
export class ProtocolValidationError extends Error {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agreementIdFromContext(orgId: string, seed: string): string {
  const salt = hexlify(randomBytes(12));
  const packed = `${orgId}:${seed}:${salt}:${Date.now()}`;
  return keccak256(toUtf8Bytes(packed));
}

function assertConfigured() {
  if (!isOnchainConfigured()) {
    throw new ProtocolNotConfiguredError(
      "On-chain protocol addresses are not configured in env — see ONCHAIN_ARCHITECTURE.md §18."
    );
  }
}

function unixToDate(ts: bigint): Date {
  return new Date(Number(ts) * 1000);
}

function dateToUnix(d: Date | string | bigint | number): bigint {
  if (typeof d === "bigint") return d;
  if (typeof d === "number") return BigInt(Math.floor(d));
  const dt = typeof d === "string" ? new Date(d) : d;
  return BigInt(Math.floor(dt.getTime() / 1000));
}

function prismaStatusFromDomain(
  raw: number
): OnchainAgreementStatus {
  switch (raw) {
    case 0:
      return "CREATED";
    case 1:
      return "FUNDED";
    case 2:
      return "ACTIVE";
    case 3:
      return "SETTLED";
    case 4:
      return "CANCELLED";
    case 5:
      return "EXPIRED";
    default:
      return "CREATED";
  }
}

// ---------------------------------------------------------------------------
// Common mirror-write helpers (used by every endpoint below)
// ---------------------------------------------------------------------------

type Ctx = { orgId: string; userId: string };

async function recordAction(
  args: {
    ctx: Ctx;
    agreementDbId: string;
    action: OnchainProtocolAction;
    txHash?: string | null;
    amount?: bigint | number;
    counterparty?: string;
    conditionId?: string;
    errorMessage?: string;
  },
  db: TxClient = prisma
) {
  return db.onchainAgreementAction.create({
    data: {
      orgId: args.ctx.orgId,
      agreementId: args.agreementDbId,
      action: args.action,
      actorUserId: args.ctx.userId,
      txHash: args.txHash ?? undefined,
      txStatus: args.txHash ? "PENDING" : "FAILED",
      amount: args.amount != null ? BigInt(args.amount) : undefined,
      counterparty: args.counterparty,
      conditionId: args.conditionId,
      errorMessage: args.errorMessage,
      submittedAt: args.txHash ? new Date() : undefined,
      failedAt: args.txHash ? undefined : new Date(),
    },
  });
}

async function getAgreementDbRowOrThrow(orgId: string, id: string) {
  const row = await prisma.onchainAgreement.findFirst({
    where: { orgId, id },
    include: { conditions: true, stream: true, actions: { take: 20, orderBy: { createdAt: "desc" } } },
  });
  if (!row) throw new AgreementNotFoundError("Agreement not found");
  return row;
}

// ---------------------------------------------------------------------------
// CREATE AGREEMENT  (basic conditional-only; see createAgreementWithStream below)
// ---------------------------------------------------------------------------

export type CreateAgreementInput = {
  seed?: string;
  moduleType: "NONE" | "CONDITIONAL" | "STREAM";
  tokenAddress?: string;
  payerAddress: string;
  principalUsdc: string;
  startTime: string | Date;
  endTime: string | Date;
  metadataHash?: string;
  initialAuthorized?: string[];
  referenceType?: "INVOICE" | "PAYROLL_RUN" | "INTERNAL_TRANSFER" | null;
  referenceId?: string | null;
};

export async function createAgreementMirror(
  ctx: Ctx,
  input: CreateAgreementInput
) {
  assertConfigured();
  const env = getEnv();

  const agreementId = agreementIdFromContext(ctx.orgId, input.seed ?? "agreement");
  const token = input.tokenAddress ?? env.ONCHAIN_USDC_ADDRESS;
  if (!token) {
    throw new ProtocolValidationError("Missing ONCHAIN_USDC_ADDRESS in env or explicit tokenAddress");
  }

  let moduleType: OnchainAgreementModule = "NONE";
  let moduleAddress = "0x0000000000000000000000000000000000000000";
  if (input.moduleType === "CONDITIONAL") {
    moduleType = "CONDITIONAL";
    if (!env.CONDITIONAL_MODULE_ADDRESS) {
      throw new ProtocolValidationError("CONDITIONAL_MODULE_ADDRESS not set in env");
    }
    moduleAddress = env.CONDITIONAL_MODULE_ADDRESS;
  } else if (input.moduleType === "STREAM") {
    moduleType = "STREAM";
    if (!env.STREAM_MODULE_ADDRESS) {
      throw new ProtocolValidationError("STREAM_MODULE_ADDRESS not set in env");
    }
    moduleAddress = env.STREAM_MODULE_ADDRESS;
  }

  const principal = usdc(input.principalUsdc);
  const startTime = dateToUnix(input.startTime);
  const endTime = dateToUnix(input.endTime);

  const tx = await createAgreement({
    agreementId,
    payer: input.payerAddress,
    token,
    principal,
    startTime,
    endTime,
    metadataHash: input.metadataHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    module: moduleAddress,
    initialAuthorized: input.initialAuthorized ?? [],
  });

  return prisma.$transaction(async (db) => {
    const row = await db.onchainAgreement.create({
      data: {
        orgId: ctx.orgId,
        agreementId,
        payerAddress: input.payerAddress,
        tokenAddress: token,
        moduleType,
        moduleAddress,
        status: "CREATED",
        principal,
        startTime: unixToDate(startTime),
        endTime: unixToDate(endTime),
        metadataHash: input.metadataHash ?? undefined,
        referenceType: input.referenceType ?? undefined,
        referenceId: input.referenceId ?? undefined,
        lastTxHash: tx.hash,
        lastTxStatus: "PENDING",
        lastTxSubmittedAt: new Date(),
      },
    });
    await recordAction(
      { ctx, agreementDbId: row.id, action: "CREATE", txHash: tx.hash },
      db
    );
    return { agreement: row, txHash: tx.hash, onchainAgreementId: agreementId };
  });
}

// ---------------------------------------------------------------------------
// LIST / GET
// ---------------------------------------------------------------------------

export async function listAgreements(
  orgId: string,
  opts: { status?: OnchainAgreementStatus; moduleType?: OnchainAgreementModule; limit?: number } = {}
) {
  const take = opts.limit ?? 50;
  return prisma.onchainAgreement.findMany({
    where: {
      orgId,
      status: opts.status,
      moduleType: opts.moduleType,
    },
    include: { stream: true, conditions: true, actions: { take: 5, orderBy: { createdAt: "desc" } } },
    take,
    orderBy: { createdAt: "desc" },
  });
}

export async function getAgreement(orgId: string, id: string) {
  return getAgreementDbRowOrThrow(orgId, id);
}

// ---------------------------------------------------------------------------
// FUND
// ---------------------------------------------------------------------------

export async function fundAgreementMirror(
  ctx: Ctx,
  id: string,
  amountUsdc: string,
  opts: { approveFirst?: boolean; tokenAddress?: string } = {}
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);

  const amount = usdc(amountUsdc);
  const onchainAgreementId = agreement.agreementId as BytesLike;

  const fundTx = opts.approveFirst
    ? (
        await approveAndFundAgreement(
          onchainAgreementId,
          amount,
          opts.tokenAddress
        )
      ).fundTx
    : await fundAgreement(onchainAgreementId, amount);

  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: {
        lastTxHash: fundTx.hash,
        lastTxStatus: "PENDING",
        lastTxSubmittedAt: new Date(),
      },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "FUND", txHash: fundTx.hash, amount },
      db
    );
    return { agreement: updated, txHash: fundTx.hash };
  });
}

// ---------------------------------------------------------------------------
// ACTIVATE / CANCEL / EXPIRE / RELEASE
// ---------------------------------------------------------------------------

async function agreementStateTransition(
  ctx: Ctx,
  id: string,
  action: Extract<OnchainProtocolAction, "ACTIVATE" | "CANCEL" | "EXPIRE">
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const onchainId = agreement.agreementId as BytesLike;

  const tx =
    action === "ACTIVATE"
      ? await activateAgreement(onchainId)
      : action === "CANCEL"
      ? await cancelAgreement(onchainId)
      : await expireAgreement(onchainId);

  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action, txHash: tx.hash },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

export const activateAgreementMirror = (ctx: Ctx, id: string) =>
  agreementStateTransition(ctx, id, "ACTIVATE");
export const cancelAgreementMirror = (ctx: Ctx, id: string) =>
  agreementStateTransition(ctx, id, "CANCEL");
export const expireAgreementMirror = (ctx: Ctx, id: string) =>
  agreementStateTransition(ctx, id, "EXPIRE");

export async function releaseToMirror(
  ctx: Ctx,
  id: string,
  args: { beneficiary: string; amountUsdc: string; conditionId?: string }
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const amount = usdc(args.amountUsdc);

  const tx = await releaseTo(
    agreement.agreementId as BytesLike,
    args.beneficiary,
    amount,
    args.conditionId ?? undefined
  );

  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      {
        ctx,
        agreementDbId: agreement.id,
        action: "RELEASE",
        txHash: tx.hash,
        amount,
        counterparty: args.beneficiary,
        conditionId: args.conditionId,
      },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

// ---------------------------------------------------------------------------
// AUTHORIZATION GRANT / REVOKE  + PREVIEW NEXT NONCE  (for EIP-712 clients)
// ---------------------------------------------------------------------------

export async function grantAuthorizationMirror(
  ctx: Ctx,
  id: string,
  actor: string
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const tx = await grantAuthorization(agreement.agreementId as BytesLike, actor);
  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "GRANT_AUTH", txHash: tx.hash, counterparty: actor },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

export async function revokeAuthorizationMirror(
  ctx: Ctx,
  id: string,
  actor: string
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const tx = await revokeAuthorization(agreement.agreementId as BytesLike, actor);
  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "REVOKE_AUTH", txHash: tx.hash, counterparty: actor },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

export async function previewNonceForActor(
  orgId: string,
  id: string,
  actor: string
): Promise<string> {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(orgId, id);
  const nonce = await previewNextNonce(agreement.agreementId as BytesLike, actor);
  return nonce.toString();
}

// ---------------------------------------------------------------------------
// CONDITIONS
// ---------------------------------------------------------------------------

export type RegisterConditionsInput = {
  conditions: (Omit<RegisterConditionInput, "earliestRelease" | "deadline"> & {
    earliestRelease?: string | Date;
    deadline?: string | Date;
  })[];
};

export async function registerConditionsMirror(
  ctx: Ctx,
  id: string,
  input: RegisterConditionsInput
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);

  const normalized: RegisterConditionInput[] = input.conditions.map((c) => ({
    conditionId: c.conditionId,
    amount: BigInt(c.amount),
    beneficiaries: c.beneficiaries,
    earliestRelease: c.earliestRelease ? dateToUnix(c.earliestRelease) : 0n,
    deadline: c.deadline ? dateToUnix(c.deadline) : 0n,
  }));

  const tx = await onchainRegisterConditions(
    agreement.agreementId as BytesLike,
    normalized
  );

  return prisma.$transaction(async (db) => {
    for (const c of normalized) {
      await db.onchainCondition.create({
        data: {
          orgId: ctx.orgId,
          agreementId: agreement.id,
          conditionId: typeof c.conditionId === "string" ? c.conditionId : hexlify(c.conditionId as Uint8Array),
          amount: BigInt(c.amount),
          beneficiaries: c.beneficiaries as unknown as Prisma.InputJsonValue,
          earliestRelease: c.earliestRelease && c.earliestRelease !== 0n ? unixToDate(BigInt(c.earliestRelease)) : undefined,
          deadline: c.deadline && c.deadline !== 0n ? unixToDate(BigInt(c.deadline)) : undefined,
        },
      });
    }
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "REGISTER_CONDITION", txHash: tx.hash },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

export async function listConditions(orgId: string, id: string) {
  const agreement = await getAgreementDbRowOrThrow(orgId, id);
  return prisma.onchainCondition.findMany({
    where: { agreementId: agreement.id, orgId },
    orderBy: { createdAt: "desc" },
  });
}

export async function authorizeConditionMirror(
  ctx: Ctx,
  id: string,
  conditionId: string,
  opts: { useBackendOperatorSignature?: boolean } = {}
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const onchainAgreementId = agreement.agreementId as BytesLike;

  let txHash: string;
  if (opts.useBackendOperatorSignature) {
    const { signature, nonce, deadline } = await operatorSignAuthorizeCondition({
      agreementId: onchainAgreementId,
      conditionId,
    });
    const tx = await (
      await import("@/lib/onchain/conditional")
    ).authorizeConditionWithSignature(
      onchainAgreementId,
      conditionId,
      nonce,
      deadline,
      signature
    );
    txHash = tx.hash;
  } else {
    const tx = await authorizeCondition(onchainAgreementId, conditionId);
    txHash = tx.hash;
  }

  return prisma.$transaction(async (db) => {
    const updatedCond = await db.onchainCondition.updateMany({
      where: { agreementId: agreement.id, conditionId },
      data: {
        authorized: true,
        authorizedByUserId: ctx.userId,
        authorizedTxHash: txHash,
        authorizedAt: new Date(),
      },
    });
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: txHash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "AUTHORIZE_CONDITION", txHash, conditionId },
      db
    );
    return { agreement: updated, txHash, conditionsAffected: updatedCond.count };
  });
}

export async function releaseConditionMirror(
  ctx: Ctx,
  id: string,
  conditionId: string
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);

  const tx = await releaseCondition(agreement.agreementId as BytesLike, conditionId);

  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "RELEASE_CONDITION", txHash: tx.hash, conditionId },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

// ---------------------------------------------------------------------------
// STREAM
// ---------------------------------------------------------------------------

export type CreateStreamAgreementInput = {
  seed?: string;
  recipientAddress: string;
  tokenAddress?: string;
  principalUsdc: string;
  startTime: string | Date;
  endTime: string | Date;
  cliff?: string | Date;
  initialAuthorized?: string[];
  referenceType?: "INVOICE" | "PAYROLL_RUN" | "INTERNAL_TRANSFER" | null;
  referenceId?: string | null;
};

export async function createStreamAgreementMirror(
  ctx: Ctx,
  input: CreateStreamAgreementInput
) {
  assertConfigured();
  const env = getEnv();

  const operatorAddr = await getOperatorAddress();

  const onchainAgreementId = agreementIdFromContext(ctx.orgId, input.seed ?? "stream");
  const token = input.tokenAddress ?? env.ONCHAIN_USDC_ADDRESS;
  if (!token) throw new ProtocolValidationError("Missing tokenAddress / ONCHAIN_USDC_ADDRESS");

  const principal = usdc(input.principalUsdc);
  const startTime = dateToUnix(input.startTime);
  const endTime = dateToUnix(input.endTime);
  const cliff = input.cliff ? dateToUnix(input.cliff) : startTime;

  const { createTx, streamTx } = await createStreamAgreement({
    agreementId: onchainAgreementId,
    payer: operatorAddr,
    token,
    principal,
    startTime,
    endTime,
    cliff,
    recipient: input.recipientAddress,
    initialAuthorized: input.initialAuthorized ?? [],
    metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  });

  return prisma.$transaction(async (db) => {
    const agreement = await db.onchainAgreement.create({
      data: {
        orgId: ctx.orgId,
        agreementId: onchainAgreementId,
        payerAddress: operatorAddr,
        tokenAddress: token,
        moduleType: "STREAM",
        moduleAddress: env.STREAM_MODULE_ADDRESS!,
        status: "CREATED",
        principal,
        startTime: unixToDate(startTime),
        endTime: unixToDate(endTime),
        referenceType: input.referenceType ?? undefined,
        referenceId: input.referenceId ?? undefined,
        lastTxHash: streamTx.hash,
        lastTxStatus: "PENDING",
        lastTxSubmittedAt: new Date(),
      },
    });
    await db.onchainStream.create({
      data: {
        orgId: ctx.orgId,
        agreementId: agreement.id,
        recipientAddress: input.recipientAddress,
        tokenAddress: token,
        startTime: unixToDate(startTime),
        endTime: unixToDate(endTime),
        cliff: input.cliff ? unixToDate(cliff) : undefined,
      },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "CREATE", txHash: createTx.hash },
      db
    );
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "CREATE_STREAM", txHash: streamTx.hash, counterparty: input.recipientAddress },
      db
    );
    return { agreement, txHashes: [createTx.hash, streamTx.hash] };
  });
}

export async function attachStreamToAgreementMirror(
  ctx: Ctx,
  id: string,
  input: Omit<CreateStreamParams, "agreementId" | "startTime" | "endTime" | "cliff"> & {
    startTime: Date | string | bigint | number;
    endTime: Date | string | bigint | number;
    cliff?: Date | string | bigint | number;
  }
) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const startTime = dateToUnix(input.startTime);
  const endTime = dateToUnix(input.endTime);
  const cliff = input.cliff ? dateToUnix(input.cliff) : startTime;

  const tx = await onchainCreateStream({
    agreementId: agreement.agreementId as BytesLike,
    recipient: input.recipient,
    startTime,
    endTime,
    cliff,
  });

  return prisma.$transaction(async (db) => {
    const env = getEnv();
    const stream = await db.onchainStream.create({
      data: {
        orgId: ctx.orgId,
        agreementId: agreement.id,
        recipientAddress: input.recipient.toString(),
        tokenAddress: env.ONCHAIN_USDC_ADDRESS ?? agreement.tokenAddress,
        startTime: unixToDate(startTime),
        endTime: unixToDate(endTime),
        cliff: unixToDate(cliff),
      },
    });
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: {
        lastTxHash: tx.hash,
        lastTxStatus: "PENDING",
        lastTxSubmittedAt: new Date(),
        moduleType: "STREAM",
        moduleAddress: env.STREAM_MODULE_ADDRESS ?? agreement.moduleAddress,
      },
    });
    await recordAction(
      {
        ctx,
        agreementDbId: agreement.id,
        action: "CREATE_STREAM",
        txHash: tx.hash,
        counterparty: input.recipient.toString(),
      },
      db
    );
    return { agreement: updated, stream, txHash: tx.hash };
  });
}

export async function claimStreamMirror(ctx: Ctx, id: string) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const stream = agreement.stream;
  if (!stream) {
    throw new ProtocolValidationError("Agreement has no stream attached");
  }
  const claimable = await claimableAmount(agreement.agreementId as BytesLike);

  const tx = await claimStream(agreement.agreementId as BytesLike);

  return prisma.$transaction(async (db) => {
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      {
        ctx,
        agreementDbId: agreement.id,
        action: "CLAIM_STREAM",
        txHash: tx.hash,
        amount: claimable,
        counterparty: stream.recipientAddress,
      },
      db
    );
    return { agreement: updated, txHash: tx.hash, claimedAmount: claimable.toString() };
  });
}

export async function cancelStreamMirror(ctx: Ctx, id: string) {
  assertConfigured();
  const agreement = await getAgreementDbRowOrThrow(ctx.orgId, id);
  const tx = await onchainCancelStream(agreement.agreementId as BytesLike);

  return prisma.$transaction(async (db) => {
    if (agreement.stream) {
      await db.onchainStream.update({
        where: { agreementId: agreement.id },
        data: { cancelled: true, cancelledAt: new Date() },
      });
    }
    const updated = await db.onchainAgreement.update({
      where: { id: agreement.id },
      data: { lastTxHash: tx.hash, lastTxStatus: "PENDING", lastTxSubmittedAt: new Date() },
    });
    await recordAction(
      { ctx, agreementDbId: agreement.id, action: "CANCEL_STREAM", txHash: tx.hash },
      db
    );
    return { agreement: updated, txHash: tx.hash };
  });
}

// ---------------------------------------------------------------------------
// ON-DEMAND ONCHAIN SYNC  (re-fetches a mirror from chain, returns updated row)
// ---------------------------------------------------------------------------

export async function syncAgreementFromChain(orgId: string, id: string) {
  const agreement = await getAgreementDbRowOrThrow(orgId, id);
  const onchainId = agreement.agreementId as BytesLike;
  const onchain = await onchainGetAgreement(onchainId);

  const updated = await prisma.onchainAgreement.update({
    where: { id: agreement.id },
    data: {
      status: prismaStatusFromDomain(onchain.status),
      deposited: onchain.deposited,
      released: onchain.released,
      activatedAt: onchain.activatedAt && onchain.activatedAt > 0n ? unixToDate(onchain.activatedAt) : undefined,
    },
    include: { conditions: true, stream: true, actions: { take: 20, orderBy: { createdAt: "desc" } } },
  });

  // Optional: sync conditions if module = CONDITIONAL
  if (updated.moduleType === "CONDITIONAL") {
    try {
      const ids = await onchainGetConditionIds(onchainId);
      for (const cid of ids) {
        const c = await onchainGetCondition(onchainId, cid);
        await prisma.onchainCondition.upsert({
          where: { agreementId_conditionId: { agreementId: updated.id, conditionId: cid } },
          create: {
            orgId,
            agreementId: updated.id,
            conditionId: cid,
            amount: c.amount,
            beneficiaries: c.beneficiaries as unknown as Prisma.InputJsonValue,
            authorized: c.authorized,
            released: c.released,
            releasedAmount: c.releasedAmount,
            earliestRelease: c.earliestRelease > 0n ? unixToDate(c.earliestRelease) : undefined,
            deadline: c.deadline > 0n ? unixToDate(c.deadline) : undefined,
          },
          update: {
            authorized: c.authorized,
            released: c.released,
            releasedAmount: c.releasedAmount,
          },
        });
      }
    } catch (e) {
      // not critical for initial mirror sync
    }
  }
  if (updated.stream && updated.moduleType === "STREAM") {
    try {
      const s = await onchainGetStream(onchainId);
      await prisma.onchainStream.update({
        where: { agreementId: updated.id },
        data: {
          deposited: s.deposited,
          claimed: s.claimed,
          cancelled: s.cancelled,
          cancelledAt: s.cancelled && s.cancelledAt > 0n ? unixToDate(s.cancelledAt) : undefined,
        },
      });
    } catch (e) {
      // ignore
    }
  }
  return updated;
}
