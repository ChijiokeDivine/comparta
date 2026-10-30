// tests/network.test.ts
//
// Pure unit tests for the mainnet/testnet resolution layer
// (lib/config/network.ts + lib/config/networkProfiles.ts). No database, no
// network, no Circle credentials required.
//
// These cover the properties that are dangerous to get wrong during the Arc
// mainnet cutover:
//   - production deployments resolve to mainnet, everything else to testnet
//   - `_MAIN` credentials are ONLY read on mainnet (no silent fallback to a
//     sandbox key in production)
//   - a key whose prefix contradicts the network fails loudly
//   - explicit ARC_CHAIN / CIRCLE_ENVIRONMENT values that contradict the
//     resolved network fail loudly instead of being silently overwritten

import { describe, expect, it } from "vitest";
import {
  applyNetworkEnv,
  describeNetwork,
  resolveAppNetwork,
  resolveNetwork,
  resolveNetworkProfile,
} from "@/lib/config/network";
import { NETWORK_PROFILES } from "@/lib/config/networkProfiles";

const TESTNET_KEY = "TEST_API_KEY:abc123:def456";
const LIVE_KEY = "LIVE_API_KEY:abc123:def456";

describe("resolveNetwork", () => {
  it("defaults to testnet when nothing is configured", () => {
    expect(resolveNetwork({})).toMatchObject({ network: "testnet", source: "default" });
    expect(resolveAppNetwork({})).toBe("testnet");
  });

  it("treats Vercel production deployments as mainnet", () => {
    expect(resolveNetwork({ VERCEL_ENV: "production" })).toMatchObject({
      network: "mainnet",
      source: "VERCEL_ENV",
    });
  });

  it("keeps preview and development deployments on testnet", () => {
    for (const VERCEL_ENV of ["preview", "development", ""]) {
      expect(resolveAppNetwork({ VERCEL_ENV })).toBe("testnet");
    }
  });

  it("lets ARC_NETWORK override VERCEL_ENV", () => {
    expect(resolveAppNetwork({ VERCEL_ENV: "production", ARC_NETWORK: "testnet" })).toBe(
      "testnet"
    );
    expect(resolveAppNetwork({ VERCEL_ENV: "preview", ARC_NETWORK: "mainnet" })).toBe(
      "mainnet"
    );
  });

  it("accepts the documented network synonyms", () => {
    for (const value of ["mainnet", "main", "production", "prod", "live", " MAINNET "]) {
      expect(resolveAppNetwork({ ARC_NETWORK: value })).toBe("mainnet");
    }
    for (const value of ["testnet", "test", "sandbox", "staging", "development", "dev"]) {
      expect(resolveAppNetwork({ ARC_NETWORK: value })).toBe("testnet");
    }
  });

  it("throws on an unrecognised ARC_NETWORK instead of guessing", () => {
    expect(() => resolveNetwork({ ARC_NETWORK: "arc" })).toThrow(/ARC_NETWORK/);
  });

  it("exposes the mainnet facts under the right chain ids", () => {
    expect(resolveNetworkProfile({ ARC_NETWORK: "mainnet" })).toMatchObject({
      chain: "ARC_MAINNET",
      chainId: 5042,
      circleEnvironment: "production",
      circleBlockchain: "ARC",
      appKitChain: "Arc",
      rpcUrl: "https://rpc.mainnet.arc.io",
    });
    expect(resolveNetworkProfile({ ARC_NETWORK: "testnet" })).toMatchObject({
      chain: "ARC_TESTNET",
      chainId: 5042002,
      circleEnvironment: "sandbox",
      circleBlockchain: "ARC-TESTNET",
      appKitChain: "Arc_Testnet",
    });
  });

  it("never lists a mainnet chain on testnet (and vice versa)", () => {
    const testnet = NETWORK_PROFILES.testnet.unifiedBalanceChains;
    const mainnet = NETWORK_PROFILES.mainnet.unifiedBalanceChains;
    expect(testnet.some((c) => mainnet.includes(c))).toBe(false);
    expect(mainnet).toContain("ARC_MAINNET");
    expect(testnet).toContain("ARC_TESTNET");
  });
});

describe("applyNetworkEnv", () => {
  it("pins the derived facts for the resolved network", () => {
    const out = applyNetworkEnv({
      CIRCLE_API_KEY: TESTNET_KEY,
      CIRCLE_ENTITY_SECRET: "secret",
    });
    expect(out.APP_NETWORK).toBe("testnet");
    expect(out.NEXT_PUBLIC_APP_NETWORK).toBe("testnet");
    expect(out.ARC_CHAIN).toBe("ARC_TESTNET");
    expect(out.CIRCLE_ENVIRONMENT).toBe("sandbox");
  });

  it("maps _MAIN credentials onto the canonical names on mainnet", () => {
    const out = applyNetworkEnv({
      VERCEL_ENV: "production",
      CIRCLE_API_KEY_MAIN: LIVE_KEY,
      CIRCLE_ENTITY_SECRET_MAIN: "live-secret",
      CIRCLE_CLIENT_KEY_MAIN: "live-client",
    });
    expect(out.APP_NETWORK).toBe("mainnet");
    expect(out.CIRCLE_API_KEY).toBe(LIVE_KEY);
    expect(out.CIRCLE_ENTITY_SECRET).toBe("live-secret");
    expect(out.CIRCLE_CLIENT_KEY).toBe("live-client");
    expect(out.CIRCLE_ENVIRONMENT).toBe("production");
    expect(out.ARC_CHAIN).toBe("ARC_MAINNET");
  });

  it("does NOT fall back to sandbox credentials on mainnet", () => {
    const out = applyNetworkEnv({
      VERCEL_ENV: "production",
      CIRCLE_API_KEY: TESTNET_KEY,
      CIRCLE_ENTITY_SECRET: "sandbox-secret",
    });
    expect(out.CIRCLE_API_KEY).toBeUndefined();
    expect(out.CIRCLE_ENTITY_SECRET).toBeUndefined();
  });

  it("keeps shared config on mainnet (only the 3 credentials are per-network)", () => {
    const out = applyNetworkEnv({
      VERCEL_ENV: "production",
      CIRCLE_API_KEY_MAIN: LIVE_KEY,
      CIRCLE_ENTITY_SECRET_MAIN: "live-secret",
      CIRCLE_WALLET_SET_ID: "shared-wallet-set",
      CIRCLE_USDC_TOKEN_ID: "shared-usdc-token",
      AGREEMENT_CORE_ADDRESS: "0xsharedcore",
    });
    expect(out.CIRCLE_WALLET_SET_ID).toBe("shared-wallet-set");
    expect(out.CIRCLE_USDC_TOKEN_ID).toBe("shared-usdc-token");
    expect(out.AGREEMENT_CORE_ADDRESS).toBe("0xsharedcore");
  });

  it("prefers a _MAIN override for shared config when one exists", () => {
    const out = applyNetworkEnv({
      ARC_NETWORK: "mainnet",
      CIRCLE_WALLET_SET_ID: "shared-wallet-set",
      CIRCLE_WALLET_SET_ID_MAIN: "mainnet-wallet-set",
    });
    expect(out.CIRCLE_WALLET_SET_ID).toBe("mainnet-wallet-set");
  });

  it("refuses a test key on mainnet", () => {
    expect(() =>
      applyNetworkEnv({
        ARC_NETWORK: "mainnet",
        CIRCLE_API_KEY_MAIN: TESTNET_KEY,
      })
    ).toThrow(/TEST_API_KEY/);
  });

  it("refuses a live key on testnet", () => {
    expect(() =>
      applyNetworkEnv({
        ARC_NETWORK: "testnet",
        CIRCLE_API_KEY: LIVE_KEY,
      })
    ).toThrow(/LIVE_API_KEY/);
  });

  it("overrides a stale ARC_CHAIN instead of failing the build", () => {
    const out = applyNetworkEnv({ ARC_NETWORK: "mainnet", ARC_CHAIN: "ARC_TESTNET" });
    expect(out.ARC_CHAIN).toBe("ARC_MAINNET");
  });

  it("overrides a stale CIRCLE_ENVIRONMENT (common on existing deployments)", () => {
    const out = applyNetworkEnv({
      VERCEL_ENV: "production",
      CIRCLE_ENVIRONMENT: "sandbox",
      CIRCLE_API_KEY_MAIN: LIVE_KEY,
    });
    expect(out.CIRCLE_ENVIRONMENT).toBe("production");
  });

  it("uses the network-specific RPC variable", () => {
    const testnet = applyNetworkEnv({ ARC_TESTNET_RPC: "https://testnet-rpc.example" });
    expect(testnet.ARC_RPC_URL).toBe("https://testnet-rpc.example");

    const mainnet = applyNetworkEnv({
      ARC_NETWORK: "mainnet",
      ARC_MAINNET_RPC: "https://mainnet-rpc.example",
    });
    expect(mainnet.ARC_RPC_URL).toBe("https://mainnet-rpc.example");
    // The testnet endpoint must never leak into a mainnet process.
    const mixed = applyNetworkEnv({
      ARC_NETWORK: "mainnet",
      ARC_TESTNET_RPC: "https://testnet-rpc.example",
    });
    expect(mixed.ARC_RPC_URL).toBe(NETWORK_PROFILES.mainnet.rpcUrl);
  });

  it("falls back to Circle's public RPC when none is configured", () => {
    expect(applyNetworkEnv({}).ARC_RPC_URL).toBe(NETWORK_PROFILES.testnet.rpcUrl);
    expect(applyNetworkEnv({ ARC_NETWORK: "mainnet" }).ARC_RPC_URL).toBe(
      NETWORK_PROFILES.mainnet.rpcUrl
    );
  });

  it("accepts the legacy ARC_*_RPC_URL aliases", () => {
    const out = applyNetworkEnv({ ARC_TESTNET_RPC_URL: "https://legacy-rpc.example" });
    expect(out.ARC_RPC_URL).toBe("https://legacy-rpc.example");
    expect(out.ARC_TESTNET_RPC_URL).toBe("https://legacy-rpc.example");
  });

  it("defaults the USDC address to the shared Arc predeploy", () => {
    expect(applyNetworkEnv({}).ONCHAIN_USDC_ADDRESS).toBe(
      "0x3600000000000000000000000000000000000000"
    );
  });
});

describe("describeNetwork", () => {
  it("reports the network without leaking secrets", () => {
    const summary = describeNetwork({
      VERCEL_ENV: "production",
      CIRCLE_API_KEY_MAIN: LIVE_KEY,
    });
    expect(summary).toMatchObject({
      network: "mainnet",
      source: "VERCEL_ENV",
      chain: "ARC_MAINNET",
      usingMainnetCredentials: true,
    });
    expect(JSON.stringify(summary)).not.toContain(LIVE_KEY);
  });

  it("flags a mainnet process with no mainnet key", () => {
    const summary = describeNetwork({ VERCEL_ENV: "production" });
    expect(summary.usingMainnetCredentials).toBe(false);
  });
});
