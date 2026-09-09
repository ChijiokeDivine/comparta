// lib/buckets/serialize.ts
//
// Prisma's LedgerAccount model stores minimumBalanceFloor as BigInt,
// which JSON.stringify (and therefore NextResponse.json) cannot
// serialize as-is. Every API route returning a raw LedgerAccount must
// go through here first — same convention as lib/invoices/serialize.ts,
// lib/allocationRules/serialize.ts, lib/savings/serialize.ts, etc.
//
// listBucketsWithBalances / getBucketDetail already shape a
// JSON-safe BucketSummary (balance as decimal string, no floor field),
// so only the create / rename / archive paths need this.

import { toDecimalString } from "@/lib/circle/amount";
import type { LedgerAccount } from "@/app/generated/prisma/client";

export function serializeBucket(bucket: LedgerAccount) {
  return {
    ...bucket,
    minimumBalanceFloor: toDecimalString(bucket.minimumBalanceFloor),
  };
}