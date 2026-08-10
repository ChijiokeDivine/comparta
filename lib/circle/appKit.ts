// lib/circle/appKit.ts
//
// Wraps App Kit's Send capability (@circle-fin/app-kit +
// @circle-fin/adapter-circle-wallets) for outbound wallet-to-wallet USDC
// transfers. This is deliberately the ONLY module that touches App Kit —
// same one-module-per-concern rule lib/circle/client.ts already follows
// for the raw Developer-Controlled Wallets SDK.
//
// IMPORTANT — which adapter, and why: App Kit ships two fundamentally
// different adapters. @circle-fin/adapter-viem-v2 signs with a BROWSER
// wallet (MetaMask etc.) that a human connects and approves each
// transaction with — it cannot be used here. This module uses
// @circle-fin/adapter-circle-wallets instead: the same
// CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET-based server-side custody Comparta
// already runs on, just executing sends through App Kit's Send capability
// instead of a raw createTransaction REST call. Nothing about custody
// changes; only how the transaction is submitted does.
//
// WHAT DIDN'T MIGRATE, AND WHY (see lib/circle/wallets.ts for these):
//   - Wallet creation (createWalletForOrg) — App Kit has no wallet-
//     provisioning capability; every example takes an existing wallet
//     address as input. Stays on the raw Developer-Controlled Wallets API.
//   - Balance reads (getWalletBalance/getUsdcBalance) — App Kit's balance
//     concept is Unified Balance (kit.getBalances()), built around Circle
//     Gateway's cross-chain deposit-and-spend model. Comparta is
//     single-chain (Arc only) and doesn't use Gateway, so adopting
//     Unified Balance here would mean adopting a materially different,
//     heavier custody/deposit model for no benefit — a plain balance
//     query stays on the raw REST call.
//   - USYC deploy/redeem (lib/savings/yield.ts, lib/circle/usyc.ts) — not
//     covered by App Kit's Send/Bridge/Swap/Unified-Balance surface at
//     all. USYC conversion is regulated money-market-fund share
//     conversion, not a same-chain token swap — using kit.swap() for it
//     would be actively wrong, not just unsupported.
//
// BEHAVIORAL CHANGE THIS MIGRATION INTRODUCES — READ BEFORE RELYING ON
// THIS IN PRODUCTION:
// The raw Circle REST flow this replaces (client.createTransaction) is
// asynchronous: it returns a PENDING transaction id, and
// jobs/confirmTransaction.ts polls client.getTransaction() until it
// reaches a terminal state. App Kit's kit.send() resolves synchronously
// to a final result ({ state: "success", txHash, explorerUrl }) per its
// documented example — there's no separate "pending id to poll" it
// exposes, and no documented equivalent to getTransaction() for an
// App-Kit-submitted send. lib/transfers/send.ts has been updated to
// treat a successful kit.send() as immediately CONFIRMED rather than
// writing PENDING + enqueueing confirmation polling. This has NOT been
// verified against a live Arc testnet run — the docs don't show a
// pending/non-terminal result shape or document failure-state values, so
// if kit.send() can in practice return a non-terminal state, this needs
// revisiting before it's trusted with real payroll runs.

import { AppKit } from "@circle-fin/app-kit";
import type { SendParams } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { getEnv } from "@/lib/env";
import { toDecimalString } from "./amount";
import type { Chain } from "@/app/generated/prisma/client";

export class AppKitSendError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AppKitSendError";
  }
}

const globalForAppKit = globalThis as unknown as {
  appKit: AppKit | undefined;
  circleWalletsAdapter: ReturnType<typeof createCircleWalletsAdapter> | undefined;
};

function getKit(): AppKit {
  if (!globalForAppKit.appKit) {
    globalForAppKit.appKit = new AppKit();
  }
  return globalForAppKit.appKit;
}

function getAdapter(): ReturnType<typeof createCircleWalletsAdapter> {
  if (!globalForAppKit.circleWalletsAdapter) {
    const env = getEnv();
    globalForAppKit.circleWalletsAdapter = createCircleWalletsAdapter({
      apiKey: env.CIRCLE_API_KEY,
      entitySecret: env.CIRCLE_ENTITY_SECRET,
    });
  }
  return globalForAppKit.circleWalletsAdapter;
}

/**
 * Maps Comparta's Chain enum to App Kit's chain identifier literal.
 * Only ARC_TESTNET is mapped — Arc is testnet-only today (per
 * docs.arc.io), and App Kit's mainnet chain literal for Arc isn't
 * documented anywhere used to build this. Throwing here on
 * ARC_MAINNET is deliberate: guessing at an unverified chain literal
 * for a real-money mainnet send is worse than failing loudly.
 */
function toAppKitChain(chain: Chain): "Arc_Testnet" {
  if (chain === "ARC_TESTNET") return "Arc_Testnet";
  throw new AppKitSendError(
    `No verified App Kit chain literal for Comparta chain "${chain}". ` +
      `Arc mainnet support needs confirming against current App Kit docs before this can send real funds.`
  );
}

export interface AppKitSendResult {
  txHash: string;
  state: string;
  explorerUrl?: string;
}

/**
 * Sends USDC from a Comparta-custodied wallet to an arbitrary Arc address
 * via App Kit's Send capability. `amount` is a bigint in micro-USDC
 * (smallest unit), matching every other money-handling function in this
 * codebase — this function does the decimal-string conversion App Kit
 * expects, so callers never touch float math on money.
 *
 * Like the function it replaces, this only submits the transfer — it
 * does not write any LedgerEntry rows. See lib/transfers/send.ts for the
 * ledger + OnchainTransaction bookkeeping around this call, and the
 * module docstring above for why that bookkeeping now treats a
 * successful call here as immediately final rather than pending.
 */
export async function sendViaAppKit(
  fromAddress: string,
  toAddress: string,
  amount: bigint,
  chain: Chain
): Promise<AppKitSendResult> {
  if (amount <= 0n) {
    throw new AppKitSendError("sendViaAppKit: amount must be positive");
  }

  const kit = getKit();
  const adapter = getAdapter();
  const appKitChain = toAppKitChain(chain);

  const sendParams: SendParams = {
    from: { adapter, chain: appKitChain, address: fromAddress },
    to: toAddress,
    amount: toDecimalString(amount),
    token: "USDC",
  };

  try {
    const result = await kit.send(sendParams);
    if (!result?.txHash) {
      throw new AppKitSendError("App Kit send() returned no txHash");
    }
    return {
      txHash: result.txHash,
      state: result.state ?? "success",
      explorerUrl: (result as { explorerUrl?: string }).explorerUrl,
    };
  } catch (err) {
    if (err instanceof AppKitSendError) throw err;
    throw new AppKitSendError(
      `App Kit failed to send ${toDecimalString(amount)} USDC from ${fromAddress} to ${toAddress}`,
      err
    );
  }
}