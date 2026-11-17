// lib/paj/service.ts
//
// Orchestrates Paj orders against Comparta's wallet + ledger. Routes call
// only this module; nothing outside lib/paj/* talks to Paj directly.
//
// Onramp:  user pays naira into a Paj virtual account → Paj delivers USDC
//          to the org's Arc wallet → the existing Circle webhook credits
//          the ledger. Comparta only tracks the order here.
// Offramp: Paj returns a one-off funding address → Comparta sends USDC
//          there through the normal sendPayment() primitive (which debits
//          the source bucket and records an OnchainTransaction) → Paj
//          pays naira into the registered bank account.

import { Prisma } from "@/app/generated/prisma/client";
import type {
  PajBankAccount,
  PajOrder,
  PajOrderStatus,
  PajOrderType,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getNetworkProfile, resolveAppNetwork } from "@/lib/config/network";
import {
  PAJ_CHAINS,
  PAJ_CURRENCY,
  type PajChainOption,
} from "@/lib/config/pajChains";
import { toDecimalString, toSmallestUnit } from "@/lib/circle/amount";
import { sendPayment, SendPaymentError } from "@/lib/transfers/send";
import {
  createPajOfframpOrder,
  createPajOnrampOrder,
  getPajTransaction,
  registerPajBankAccount as registerWithPaj,
} from "./api";
import { PajApiError } from "./client";
import {
  getPajChainForWallet,
  getPajUnavailableReason,
  getPajWebhookUrl,
} from "./config";
import { ensurePajWebhookRegistered } from "./webhookConfig";
import {
  pajTransactionTypeMatchesOrder,
  resolveStatusTransition,
} from "./webhookState";
import type { PajOrderWebhookPayload, PajTransaction } from "./types";

export class PajServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "PAJ_ERROR"
  ) {
    super(message);
    this.name = "PajServiceError";
  }
}

export interface PajAvailabilityView {
  available: boolean;
  reason: string | null;
  currency: string;
  chain: { id: string; label: string; tokenSymbol: string } | null;
  chains: Array<{ id: string; label: string; enabled: boolean }>;
}

export interface PajOrderView {
  id: string;
  type: PajOrderType;
  status: PajOrderStatus;
  pajOrderId: string;
  chain: string;
  currency: string;
  tokenAmount: string | null;
  fiatAmount: string | null;
  rate: string | null;
  fee: string | null;
  recipientAddress: string | null;
  depositAddress: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  memo: string | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PajBankAccountView {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  evmAddress: string | null;
}

function moneyString(value: { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function normalizeTokenAmount(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const fixed = n.toFixed(6);
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeFiatAmount(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function normalizeRate(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(6);
}

function mapStatus(status: string | null | undefined): PajOrderStatus | null {
  switch (status) {
    case "INIT":
      return "INIT";
    case "PAID":
    case "PROCESSING":
      return "PROCESSING";
    case "COMPLETED":
      return "COMPLETED";
    case "ERROR":
      return "ERROR";
    default:
      return null;
  }
}

export function serializePajOrder(order: PajOrder): PajOrderView {
  return {
    id: order.id,
    type: order.type,
    status: order.status,
    pajOrderId: order.pajOrderId,
    chain: order.chain,
    currency: order.currency,
    tokenAmount: moneyString(order.tokenAmount),
    fiatAmount: moneyString(order.fiatAmount),
    rate: moneyString(order.rate),
    fee: moneyString(order.fee),
    recipientAddress: order.recipientAddress,
    depositAddress: order.depositAddress,
    bankName: order.bankName,
    accountNumber: order.accountNumber,
    accountName: order.accountName,
    memo: order.memo,
    failureReason: order.failureReason,
    completedAt: order.completedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

export function serializePajBankAccount(account: PajBankAccount): PajBankAccountView {
  return {
    id: account.id,
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    evmAddress: account.evmAddress,
  };
}

function activeWalletWhere(orgId: string) {
  return {
    orgId,
    chain: getNetworkProfile(resolveAppNetwork()).chain,
  };
}

export async function getPajAvailability(orgId: string): Promise<PajAvailabilityView> {
  const wallet = await prisma.wallet.findFirst({
    where: activeWalletWhere(orgId),
    select: { chain: true },
  });
  const chain = getPajChainForWallet(wallet?.chain);
  const reason = getPajUnavailableReason(wallet?.chain ?? null);

  return {
    available: reason === null && chain !== null,
    reason,
    currency: PAJ_CURRENCY,
    chain: chain
      ? { id: chain.id, label: chain.label, tokenSymbol: chain.tokenSymbol }
      : null,
    chains: PAJ_CHAINS.map((c) => ({
      id: c.id,
      label: c.label,
      enabled: c.enabled,
    })),
  };
}

async function requireActiveWallet(orgId: string) {
  const wallet = await prisma.wallet.findFirst({
    where: activeWalletWhere(orgId),
  });
  if (!wallet) {
    throw new PajServiceError("Create a wallet before using bank transfers.", 422, "NO_WALLET");
  }
  const chain = getPajChainForWallet(wallet.chain);
  if (!chain) {
    const reason = getPajUnavailableReason(wallet.chain);
    throw new PajServiceError(reason ?? "Bank transfers aren't available.", 422, "PAJ_UNAVAILABLE");
  }
  return { wallet, chain };
}

function orderDataFromPaj(
  remote: PajTransaction,
  fallback: {
    tokenMint: string;
    chain: string;
    tokenAmount?: string | null;
    fiatAmount?: string | null;
  }
) {
  return {
    status: mapStatus(remote.status) ?? "INIT",
    chain: remote.chain ?? fallback.chain,
    tokenMint: remote.mint ?? fallback.tokenMint,
    currency: remote.currency ?? PAJ_CURRENCY,
    tokenAmount:
      normalizeTokenAmount(remote.amount) ?? fallback.tokenAmount ?? null,
    fiatAmount:
      normalizeFiatAmount(remote.fiatAmount) ?? fallback.fiatAmount ?? null,
    rate: normalizeRate(remote.rate),
    fee: normalizeTokenAmount(remote.fee),
    providerSignature: remote.signature?.trim() || null,
    rawPayload: remote as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Opens a naira → USDC order. Returns the virtual bank account the user
 * must pay. Funds land in the org's Arc wallet and are credited by the
 * existing Circle webhook.
 */
export async function createOnrampOrder(input: {
  orgId: string;
  fiatAmount: number;
  chainId?: string;
}): Promise<PajOrderView> {
  const { wallet, chain } = await requireActiveWallet(input.orgId);
  assertRequestedChain(chain, input.chainId);

  if (!Number.isFinite(input.fiatAmount) || input.fiatAmount <= 0) {
    throw new PajServiceError("Enter a valid naira amount.", 422, "INVALID_AMOUNT");
  }
  const fiatAmount = Math.round(input.fiatAmount * 100) / 100;

  // Point the key's ramp webhook at this deployment (and store its signing
  // secret) before the order exists, so every transition is signed.
  await ensurePajWebhookRegistered();
  const webhookUrl = getPajWebhookUrl();

  const remote = await createPajOnrampOrder({
    fiatAmount,
    currency: PAJ_CURRENCY,
    recipient: wallet.arcAddress,
    mint: chain.tokenMint,
    chain: chain.id,
    // Set only when this deployment has a public URL; otherwise Paj uses
    // the key's rampWebhookURL that ensurePajWebhookRegistered() just set.
    ...(webhookUrl ? { webhookURL: webhookUrl } : {}),
    userExternalId: input.orgId,
  });

  const created = await prisma.pajOrder.create({
    data: {
      orgId: input.orgId,
      type: "ONRAMP",
      pajOrderId: remote.id,
      recipientAddress: wallet.arcAddress,
      accountNumber: remote.accountNumber ?? null,
      accountName: remote.accountName ?? null,
      bankName: remote.bank ?? null,
      webhookUrl,
      ...orderDataFromPaj(remote, {
        tokenMint: chain.tokenMint,
        chain: chain.id,
        fiatAmount: fiatAmount.toFixed(2),
      }),
    },
  });

  return serializePajOrder(created);
}

/**
 * Opens a USDC → naira order and immediately funds it from the chosen
 * bucket. If the on-chain send fails, the local order is marked ERROR (or
 * left INIT when the outcome is unknown) so the ledger never drifts.
 */
export async function createOfframpOrder(input: {
  orgId: string;
  fromLedgerAccountId: string;
  bankAccountId: string;
  amount: string;
  memo?: string;
  idempotencyKey: string;
}): Promise<PajOrderView> {
  const { chain } = await requireActiveWallet(input.orgId);

  const bank = await prisma.pajBankAccount.findFirst({
    where: { id: input.bankAccountId, orgId: input.orgId },
  });
  if (!bank) {
    throw new PajServiceError("Choose a saved beneficiary first.", 404, "ACCOUNT_NOT_FOUND");
  }

  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: { id: input.fromLedgerAccountId, orgId: input.orgId, archived: false },
  });
  if (!ledgerAccount) {
    throw new PajServiceError("Source bucket not found.", 404, "ACCOUNT_NOT_FOUND");
  }

  let normalizedAmount: string;
  let amountNumber: number;
  try {
    const smallest = toSmallestUnit(input.amount);
    if (smallest <= 0n) throw new Error("zero");
    normalizedAmount = toDecimalString(smallest);
    amountNumber = Number(normalizedAmount);
  } catch {
    throw new PajServiceError("Enter a valid USDC amount.", 422, "INVALID_AMOUNT");
  }

  await ensurePajWebhookRegistered();
  const webhookUrl = getPajWebhookUrl();

  const remote = await createPajOfframpOrder({
    accountNumber: bank.accountNumber,
    bankCode: bank.bankCode,
    currency: PAJ_CURRENCY,
    amount: amountNumber,
    mint: chain.tokenMint,
    chain: chain.id,
    description: input.memo?.trim() || undefined,
    ...(webhookUrl ? { webhookURL: webhookUrl } : {}),
  });

  const local = await prisma.pajOrder.create({
    data: {
      orgId: input.orgId,
      type: "OFFRAMP",
      pajOrderId: remote.id,
      depositAddress: remote.address ?? null,
      webhookUrl,
      bankAccountId: bank.id,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      fromLedgerAccountId: ledgerAccount.id,
      memo: input.memo?.trim() || null,
      ...orderDataFromPaj(remote, {
        tokenMint: chain.tokenMint,
        chain: chain.id,
        tokenAmount: normalizedAmount,
      }),
    },
  });

  if (!remote.address) {
    await prisma.pajOrder.update({
      where: { id: local.id },
      data: {
        status: "ERROR",
        failureReason: "Paj didn't return a funding address.",
      },
    });
    throw new PajServiceError(
      "Couldn't get a funding address from Paj. Try again.",
      502,
      "PROVIDER_ERROR"
    );
  }

  try {
    const sent = await sendPayment({
      orgId: input.orgId,
      fromLedgerAccountId: ledgerAccount.id,
      toIdentifier: remote.address,
      amount: normalizedAmount,
      memo: input.memo?.trim() || `Bank payout ${remote.id}`,
      referenceType: "ONCHAIN_TX",
      referenceId: local.id,
      idempotencyKey: `paj-offramp-${input.idempotencyKey}`,
    });

    const updated = await prisma.pajOrder.update({
      where: { id: local.id },
      data: { onchainTransactionId: sent.onchainTransactionId },
    });
    return serializePajOrder(updated);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The USDC transfer could not be sent.";
    const definitive =
      err instanceof SendPaymentError &&
      ["INSUFFICIENT_BALANCE", "INVALID_AMOUNT", "INVALID_RECIPIENT", "ACCOUNT_NOT_FOUND"].includes(
        err.code
      );

    await prisma.pajOrder.update({
      where: { id: local.id },
      data: {
        status: definitive ? "ERROR" : local.status,
        failureReason: message,
      },
    });

    if (err instanceof SendPaymentError) {
      const status =
        err.code === "INSUFFICIENT_BALANCE" || err.code === "INVALID_AMOUNT"
          ? 422
          : err.code === "ALREADY_IN_FLIGHT"
            ? 409
            : err.code === "ACCOUNT_NOT_FOUND"
              ? 404
              : 502;
      throw new PajServiceError(err.message, status, err.code);
    }
    throw new PajServiceError(message, 502, "PROVIDER_ERROR");
  }
}

function assertRequestedChain(chain: PajChainOption, requested?: string) {
  if (!requested) return;
  if (requested !== chain.id) {
    throw new PajServiceError(
      `${chain.label} is the only supported bank-transfer chain right now.`,
      422,
      "UNSUPPORTED_CHAIN"
    );
  }
}

async function applyRemoteUpdate(order: PajOrder, remote: PajTransaction) {
  const next = orderDataFromPaj(remote, {
    tokenMint: order.tokenMint,
    chain: order.chain,
    tokenAmount: moneyString(order.tokenAmount),
    fiatAmount: moneyString(order.fiatAmount),
  });
  // Polling and webhooks can race. The same monotonic rules apply here, so a
  // slow poll can never put a completed order back into PROCESSING.
  const transition = resolveStatusTransition(order.status, next.status);
  const status =
    transition.apply && transition.nextStatus ? transition.nextStatus : order.status;

  return prisma.pajOrder.update({
    where: { id: order.id },
    data: {
      ...next,
      status,
      providerSignature: remote.signature?.trim() || order.providerSignature,
      bankName: remote.bank ?? order.bankName,
      accountNumber: remote.accountNumber ?? order.accountNumber,
      accountName: remote.accountName ?? order.accountName,
      depositAddress: remote.address ?? order.depositAddress,
      recipientAddress: remote.recipient ?? order.recipientAddress,
      completedAt:
        status === "COMPLETED" ? order.completedAt ?? new Date() : order.completedAt,
      failureReason:
        status === "ERROR"
          ? order.failureReason ?? offrampFailureReason(order)
          : null,
    },
  });
}

/**
 * An offramp that errors after we funded it has already taken USDC from the
 * bucket. Say so explicitly instead of a generic provider error, so nobody
 * sends the payout a second time without checking.
 */
function offrampFailureReason(order: {
  type: PajOrderType;
  onchainTransactionId: string | null;
}): string {
  if (order.type === "OFFRAMP" && order.onchainTransactionId) {
    return "Paj reported an error after the USDC was sent. Check the payout with Paj before retrying.";
  }
  return "Paj reported an error.";
}

/** Pull the latest state for one order from Paj. Terminal orders are skipped. */
export async function syncPajOrder(order: PajOrder): Promise<PajOrder> {
  if (order.status === "COMPLETED" || order.status === "ERROR") return order;

  const remote = await getPajTransaction(order.pajOrderId);
  if (!remote) return order;
  return applyRemoteUpdate(order, remote);
}

export async function listPajOrders(
  orgId: string,
  options: { type?: PajOrderType; sync?: boolean; limit?: number } = {}
): Promise<PajOrderView[]> {
  const limit = Math.min(options.limit ?? 50, 100);
  const where = {
    orgId,
    ...(options.type ? { type: options.type } : {}),
  };

  let orders = await prisma.pajOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (options.sync) {
    const active = orders
      .filter((order) => order.status === "INIT" || order.status === "PROCESSING")
      .slice(0, 5);
    if (active.length > 0) {
      await Promise.allSettled(active.map((order) => syncPajOrder(order)));
      orders = await prisma.pajOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    }
  }

  return orders.map(serializePajOrder);
}

export async function getPajOrder(
  orgId: string,
  id: string,
  options: { sync?: boolean } = {}
): Promise<PajOrderView> {
  let order = await prisma.pajOrder.findFirst({ where: { id, orgId } });
  if (!order) throw new PajServiceError("Order not found.", 404, "NOT_FOUND");

  if (options.sync) {
    try {
      order = await syncPajOrder(order);
    } catch (err) {
      // A transient Paj failure must not hide an order the user can see.
      console.error(`[paj] status sync failed for ${order.id}`, err);
    }
  }
  return serializePajOrder(order);
}

export async function listPajBankAccounts(orgId: string): Promise<PajBankAccountView[]> {
  const accounts = await prisma.pajBankAccount.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
  return accounts.map(serializePajBankAccount);
}

/** Registers + confirms an account with the bank, then saves it for reuse. */
export async function registerPajBankAccount(input: {
  orgId: string;
  bankCode: string;
  accountNumber: string;
}): Promise<PajBankAccountView> {
  if (!/^\d{10}$/.test(input.accountNumber)) {
    throw new PajServiceError("Enter a 10-digit account number.", 422, "INVALID_ACCOUNT");
  }

  let remote;  try {
    remote = await registerWithPaj({
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    });
  } catch (err) {
    if (err instanceof PajApiError) {
      throw new PajServiceError(
        err.status === 400
          ? "We couldn't confirm that account. Check the bank and number."
          : err.message,
        err.status === 400 ? 422 : 502,
        "BANK_ACCOUNT_ERROR"
      );
    }
    throw err;
  }

  const saved = await prisma.pajBankAccount.upsert({
    where: {
      orgId_bankCode_accountNumber: {
        orgId: input.orgId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
      },
    },
    create: {
      orgId: input.orgId,
      pajId: remote.id,
      bankCode: input.bankCode,
      bankName: remote.bank,
      accountNumber: remote.accountNumber,
      accountName: remote.accountName,
      solanaAddress: remote.address ?? null,
      evmAddress: remote.evmAddress ?? null,
    },
    update: {
      pajId: remote.id,
      bankName: remote.bank,
      accountName: remote.accountName,
      solanaAddress: remote.address ?? null,
      evmAddress: remote.evmAddress ?? null,
    },
  });

  return serializePajBankAccount(saved);
}

export interface PajWebhookApplyResult {
  matched: boolean;
  orderId?: string;
  previousStatus?: PajOrderStatus;
  status?: PajOrderStatus;
  changed: boolean;
  /** Populated when the delivery was stored but deliberately not applied. */
  ignoredReason?: string;
}

/**
 * Apply one verified Paj delivery to the local order.
 *
 * Money safety:
 *   - The delivery must match our stored order type (no cross-order writes).
 *   - The status only moves forward; terminal states are never overwritten.
 *   - The update is a compare-and-swap on the status we read, so two
 *     concurrent retries cannot both win and reorder the timeline.
 *   - Nothing here credits the ledger: onramp USDC is credited by the Circle
 *     inbound webhook, and offramp USDC was already debited by sendPayment().
 */
export async function applyPajOrderWebhook(
  payload: PajOrderWebhookPayload
): Promise<PajWebhookApplyResult> {
  const order = await prisma.pajOrder.findUnique({
    where: { pajOrderId: payload.id },
  });
  if (!order) {
    return {
      matched: false,
      changed: false,
      ignoredReason: "No local order matches this id.",
    };
  }

  if (!pajTransactionTypeMatchesOrder(payload.transactionType, order.type)) {
    return {
      matched: true,
      orderId: order.id,
      previousStatus: order.status,
      status: order.status,
      changed: false,
      ignoredReason: `transactionType ${payload.transactionType} does not match ${order.type}.`,
    };
  }

  const incoming = mapStatus(payload.status);
  const transition = resolveStatusTransition(order.status, incoming);

  if (!transition.apply) {
    // Keep the audit trail of the delivery without touching status or money
    // fields. The base result is a 2xx, so Paj does not retry-storm.
    await prisma.pajOrder.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        lastWebhookAt: new Date(),
        rawPayload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      matched: true,
      orderId: order.id,
      previousStatus: order.status,
      status: order.status,
      changed: false,
      ignoredReason: transition.reason,
    };
  }

  const status = transition.nextStatus ?? order.status;
  const updated = await prisma.pajOrder.updateMany({
    where: { id: order.id, status: order.status },
    data: {
      status,
      lastWebhookAt: new Date(),
      rawPayload: payload as unknown as Prisma.InputJsonValue,
      providerSignature: payload.signature?.trim() || order.providerSignature,
      ...(payload.chain ? { chain: payload.chain } : {}),
      ...(payload.mint ? { tokenMint: payload.mint } : {}),
      ...(payload.currency ? { currency: payload.currency } : {}),
      ...(normalizeTokenAmount(payload.amount)
        ? { tokenAmount: normalizeTokenAmount(payload.amount) }
        : {}),
      ...(normalizeFiatAmount(payload.fiatAmount)
        ? { fiatAmount: normalizeFiatAmount(payload.fiatAmount) }
        : {}),
      ...(normalizeRate(payload.rate) ? { rate: normalizeRate(payload.rate) } : {}),
      ...(normalizeTokenAmount(payload.fee)
        ? { fee: normalizeTokenAmount(payload.fee) }
        : {}),
      ...(payload.address ? { depositAddress: payload.address } : {}),
      ...(payload.recipient ? { recipientAddress: payload.recipient } : {}),
      ...(payload.bank ? { bankName: payload.bank } : {}),
      ...(payload.accountNumber ? { accountNumber: payload.accountNumber } : {}),
      ...(payload.accountName ? { accountName: payload.accountName } : {}),
      ...(status === "COMPLETED"
        ? { completedAt: order.completedAt ?? new Date() }
        : {}),
      ...(status === "ERROR"
        ? { failureReason: order.failureReason ?? offrampFailureReason(order) }
        : status === "COMPLETED" || status === "PROCESSING"
          ? { failureReason: null }
          : {}),
    },
  });

  if (updated.count === 0) {
    return {
      matched: true,
      orderId: order.id,
      previousStatus: order.status,
      status: order.status,
      changed: false,
      ignoredReason: "Another delivery updated this order first.",
    };
  }

  return {
    matched: true,
    orderId: order.id,
    previousStatus: order.status,
    status,
    changed: transition.changed,
  };
}

/**
 * Settings → Webhooks "Reprocess" action for a stored Paj delivery.
 * Refuses unverified events: replaying a payload we never authenticated would
 * defeat the whole point of signature checking.
 */
export async function reprocessPajWebhookEvent(
  eventId: string
): Promise<PajWebhookApplyResult> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.source !== "paj") {
    throw new PajServiceError("Not a Paj webhook event.", 404, "NOT_FOUND");
  }
  if (!event.signatureOk) {
    throw new PajServiceError(
      "This delivery was never signature-verified, so it can't be applied.",
      422,
      "UNVERIFIED_EVENT"
    );
  }

  const payload = event.rawPayload as unknown as PajOrderWebhookPayload;
  if (!payload || typeof payload !== "object" || !payload.id) {
    throw new PajServiceError("Stored payload has no order id.", 422, "INVALID_PAYLOAD");
  }

  const result = await applyPajOrderWebhook(payload);

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      processError:
        result.ignoredReason ??
        (result.matched ? null : "No local order matches this id."),
    },
  });

  return result;
}
