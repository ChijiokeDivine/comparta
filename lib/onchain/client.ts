// lib/onchain/client.ts
//
// Provider + signer singletons and typed contract getters.
//
// Contract instance construction ALWAYS goes through the typechain
// factory's `static connect(address, runner)` method. This returns the
// typed contract interface (`AgreementCore`, `ConditionalPaymentModule`,
// etc.) so every method call is type-checked at the TS boundary.
//
// Write calls return ethers `ContractTransactionResponse` (the same
// typechain contract-method return type) — never an ad-hoc interface.

import { JsonRpcProvider, Wallet, type ContractRunner, type Signer } from "ethers";
import type { ContractTransactionResponse } from "ethers";

import {
  AgreementCore__factory,
  ConditionalPaymentModule__factory,
  StreamModule__factory,
  IERC20__factory,
} from "@/types/typechain-types";

import type {
  AgreementCore,
  ConditionalPaymentModule,
  StreamModule,
  IERC20,
} from "@/types/typechain-types";

import { getEnv } from "@/lib/env";

export { ContractTransactionResponse };

export class OnchainNotConfiguredError extends Error {
  constructor(detail: string) {
    super(
      `On-chain protocol is not configured for this environment: ${detail}. ` +
        `See lib/docs/ONCHAIN_ARCHITECTURE.md section 18.`
    );
    this.name = "OnchainNotConfiguredError";
  }
}

let cachedProvider: JsonRpcProvider | null = null;
let cachedSigner: Signer | null = null;

function resolveRpcUrl(env: ReturnType<typeof getEnv>): string {
  const url =
    env.ARC_CHAIN === "ARC_MAINNET"
      ? env.ARC_MAINNET_RPC_URL
      : env.ARC_TESTNET_RPC_URL;
  if (!url) {
    throw new OnchainNotConfiguredError(
      `missing RPC URL for ARC_CHAIN=${env.ARC_CHAIN}`
    );
  }
  return url;
}

/** Cached shared JsonRpcProvider for the configured Arc chain. */
export function getProvider(): JsonRpcProvider {
  if (cachedProvider) return cachedProvider;
  const env = getEnv();
  const rpc = resolveRpcUrl(env);
  cachedProvider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  return cachedProvider;
}

/**
 * Operator signer (Wallet for v1; swap for Circle/HSM in prod).
 * Throws `OnchainNotConfiguredError` if `ONCHAIN_OPERATOR_PRIVATE_KEY`
 * is not set.
 */
export function getOperatorSigner(): Signer {
  if (cachedSigner) return cachedSigner;
  const env = getEnv();
  const pk = env.ONCHAIN_OPERATOR_PRIVATE_KEY;
  if (!pk) {
    throw new OnchainNotConfiguredError("missing ONCHAIN_OPERATOR_PRIVATE_KEY");
  }
  cachedSigner = new Wallet(pk, getProvider());
  return cachedSigner;
}

// --- Contract instance getters (use factory.static connect) ------------

function requireEnvAddress(value: string | undefined, label: string): string {
  if (!value) throw new OnchainNotConfiguredError(`missing ${label}`);
  return value;
}

/**
 * Return a typed AgreementCore contract instance.
 * Default runner is the operator signer — pass `getProvider()` for reads.
 */
export function getAgreementCore(
  runner: ContractRunner = getOperatorSigner()
): AgreementCore {
  const env = getEnv();
  const address = requireEnvAddress(
    env.AGREEMENT_CORE_ADDRESS,
    "AGREEMENT_CORE_ADDRESS"
  );
  return AgreementCore__factory.connect(address, runner);
}

export function getConditionalModule(
  runner: ContractRunner = getOperatorSigner()
): ConditionalPaymentModule {
  const env = getEnv();
  const address = requireEnvAddress(
    env.CONDITIONAL_MODULE_ADDRESS,
    "CONDITIONAL_MODULE_ADDRESS"
  );
  return ConditionalPaymentModule__factory.connect(address, runner);
}

export function getStreamModule(
  runner: ContractRunner = getOperatorSigner()
): StreamModule {
  const env = getEnv();
  const address = requireEnvAddress(
    env.STREAM_MODULE_ADDRESS,
    "STREAM_MODULE_ADDRESS"
  );
  return StreamModule__factory.connect(address, runner);
}

export function getUsdcToken(
  address?: string,
  runner: ContractRunner = getOperatorSigner()
): IERC20 {
  const env = getEnv();
  const tokenAddress =
    address ??
    requireEnvAddress(env.ONCHAIN_USDC_ADDRESS, "ONCHAIN_USDC_ADDRESS");
  return IERC20__factory.connect(tokenAddress, runner);
}

// --- Diagnostics / admin ----------------------------------------------

export async function getOperatorAddress(): Promise<string> {
  return await getOperatorSigner().getAddress();
}

/**
 * True when env has all addresses + RPC URL needed to talk to the
 * protocol. Does NOT verify deployed bytecode matches.
 */
export function isOnchainConfigured(): boolean {
  try {
    const env = getEnv();
    return Boolean(
      (env.ARC_MAINNET_RPC_URL || env.ARC_TESTNET_RPC_URL) &&
        env.AGREEMENT_CORE_ADDRESS &&
        env.CONDITIONAL_MODULE_ADDRESS &&
        env.STREAM_MODULE_ADDRESS
    );
  } catch {
    return false;
  }
}
