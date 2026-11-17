// lib/paj/api.ts
//
// Typed wrappers for the Paj endpoints Comparta uses. Rates and the bank
// list are cached briefly because both are read on every modal open and
// change slowly.

import { pajRequest } from "./client";
import type {
  CreateOfframpOrderInput,
  CreateOnrampOrderInput,
  PajBank,
  PajBankAccount,
  PajRates,
  PajTransaction,
  PajWebhookConfig,
  PajWebhookTestResult,
} from "./types";

const RATE_TTL_MS = 30_000;
const BANK_TTL_MS = 6 * 60 * 60 * 1000;

const rateCache = new Map<string, { at: number; value: PajRates }>();
let bankCache: { at: number; value: PajBank[] } | null = null;

export async function getPajRates(currency = "NGN"): Promise<PajRates> {
  const cached = rateCache.get(currency);
  if (cached && Date.now() - cached.at < RATE_TTL_MS) return cached.value;

  const rates = await pajRequest<PajRates>("/pub/v2/rate", {
    query: { currency },
  });
  rateCache.set(currency, { at: Date.now(), value: rates });
  return rates;
}

/** All Nigerian banks, sorted A→Z. Cached for six hours. */
export async function listPajBanks(search?: string): Promise<PajBank[]> {
  if (!bankCache || Date.now() - bankCache.at > BANK_TTL_MS) {
    const banks = await pajRequest<PajBank[]>("/pub/v2/bank", {
      query: { country: "NG" },
    });
    bankCache = {
      at: Date.now(),
      value: [...banks].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  const q = search?.trim().toLowerCase();
  if (!q) return bankCache.value;
  return bankCache.value.filter((bank) => bank.name.toLowerCase().includes(q));
}

export async function registerPajBankAccount(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<PajBankAccount> {
  return pajRequest<PajBankAccount>("/pub/v2/bank-account", {
    method: "POST",
    body: input,
  });
}

export async function createPajOnrampOrder(
  input: CreateOnrampOrderInput
): Promise<PajTransaction> {
  return pajRequest<PajTransaction>("/pub/v2/onramp", {
    method: "POST",
    body: input,
  });
}

export async function createPajOfframpOrder(
  input: CreateOfframpOrderInput
): Promise<PajTransaction> {
  return pajRequest<PajTransaction>("/pub/v2/offramp", {
    method: "POST",
    body: input,
  });
}

export async function getPajTransaction(id: string): Promise<PajTransaction | null> {
  return pajRequest<PajTransaction>(`/pub/v2/transaction/${encodeURIComponent(id)}`, {
    allowNotFound: true,
  });
}

/**
 * Points the API key's ramp webhook at `rampWebhookURL` and returns the full
 * configuration, including the key's `webhookSecret`. Paj only exposes the
 * secret here, so registration is also how Comparta obtains it.
 *
 * Sending the URL already configured is a no-op that still returns the secret.
 */
export async function updatePajWebhooks(input: {
  rampWebhookURL: string;
}): Promise<PajWebhookConfig> {
  return pajRequest<PajWebhookConfig>("/pub/v2/webhook", {
    method: "PATCH",
    body: input,
  });
}

/**
 * Asks Paj to POST a signed sample order to the key's ramp webhook. Nothing
 * is created; the result reports whether our endpoint answered 2xx.
 */
export async function testPajWebhook(
  type: "RAMP" = "RAMP"
): Promise<PajWebhookTestResult> {
  return pajRequest<PajWebhookTestResult>("/pub/v2/webhook/test", {
    method: "POST",
    query: { type },
  });
}
