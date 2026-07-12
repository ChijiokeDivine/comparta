// app/api/transfers/route.ts
//
// Paginated onchain transaction history for the authenticated org,
// across both directions (sends and receives). OnchainTransaction has no
// direct FK to LedgerAccount (it's scoped by walletId, and an org's
// wallet can back multiple ledger buckets) — filtering by ledgerAccountId
// goes through LedgerEntry.referenceId, the same polymorphic link the
// ledger engine itself uses.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { toDecimalString } from "@/lib/circle/amount";
import type { Prisma, OnchainDirection, OnchainTransaction } from "@/app/generated/prisma/client";

const querySchema = z.object({
  ledgerAccountId: z.string().optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  counterparty: z.string().optional(), // matches counterpartyAddress, case-insensitive substring
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const q = parsed.data;

    const wallets = await prisma.wallet.findMany({ where: { orgId }, select: { id: true } });
    const walletIds = wallets.map((w: { id: string }) => w.id);
    if (walletIds.length === 0) {
      return NextResponse.json({ transactions: [], nextCursor: null });
    }

    const where: Prisma.OnchainTransactionWhereInput = { walletId: { in: walletIds } };

    if (q.direction) where.direction = q.direction as OnchainDirection;
    if (q.counterparty) {
      where.counterpartyAddress = { contains: q.counterparty, mode: "insensitive" };
    }
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    if (q.ledgerAccountId) {
      // Ownership check: the ledger account must actually belong to this org.
      const account = await prisma.ledgerAccount.findFirst({
        where: { id: q.ledgerAccountId, orgId },
        select: { id: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Ledger account not found" }, { status: 404 });
      }

      const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerAccountId: q.ledgerAccountId, referenceType: "ONCHAIN_TX" },
        select: { referenceId: true },
      });
      where.id = { in: entries.map((e: { referenceId: string }) => e.referenceId) };
    }

    const transactions = await prisma.onchainTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = transactions.length > q.limit;
    const page = hasMore ? transactions.slice(0, q.limit) : transactions;

    return NextResponse.json({
      transactions: page.map((t: OnchainTransaction) => ({
        id: t.id,
        direction: t.direction,
        status: t.status,
        amount: toDecimalString(t.amount),
        counterpartyAddress: t.counterpartyAddress,
        chain: t.chain,
        sourceChain: t.sourceChain,
        txHash: t.txHash,
        memo: t.memo,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        createdAt: t.createdAt,
        confirmedAt: t.confirmedAt,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[transfers] history fetch failed", err);
    return NextResponse.json({ error: "Failed to fetch transaction history" }, { status: 500 });
  }
}