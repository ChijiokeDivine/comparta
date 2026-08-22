// lib/onchain/index.ts
//
// Barrel export for the on-chain protocol integration layer.
// See ONCHAIN_ARCHITECTURE.md §19 for the overall design.
//
// Example:
//   import { createAgreement, fundAgreement, AgreementStatus } from "@/lib/onchain";

export * from "./types";
export * from "./client";
export * from "./agreements";
export * from "./conditional";
export * from "./stream";
