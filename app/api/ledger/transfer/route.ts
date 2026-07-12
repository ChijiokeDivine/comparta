// app/api/ledger/transfer/route.ts
//
// Moves funds between two of the authenticated org's own LedgerAccount
// buckets (e.g. Operating -> Tax Reserve). Purely internal — never
// touches the blockchain, never leaves Postgres. Both accounts must
// belong to the requesting org (enforced below) so one org can never
// move another org's money.

import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { assertCanManageBucket, BucketPermissionError } from "@/lib/auth/canManageBucket";
import { transferBetweenLedgerAccounts, InsufficientBalanceError, LedgerError } from "@/lib/ledger/engine";
import { toSmallestUnit, toDecimalString } from "@/lib/circle/amount";

const transferSchema = z.object({
  fromLedgerAccountId: z.string().min(1),
  toLedgerAccountId: z.string().min(1),
  amount: z.string().min(1), // decimal string, e.g. "150.00"
});

export async function POST(req: Request) {
  try {
    const ctx = await requireApprovedOrg();
    const { orgId } = ctx;

    // MEMBER role users can view bucket balances but never move money
    // between them — see lib/auth/canManageBucket.ts. This is the same
    // check Payroll/Savings will call for their own fund-moving actions.
    assertCanManageBucket(ctx);

    const body = await req.json().catch(() => null);
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fromLedgerAccountId, toLedgerAccountId, amount } = parsed.data;

    // Ownership check — both accounts must belong to the caller's org, and
    // neither may be archived (an archived bucket is retired — no new
    // activity, in or out).
    const accounts = await prisma.ledgerAccount.findMany({
      where: { id: { in: [fromLedgerAccountId, toLedgerAccountId] }, orgId },
      select: { id: true, archived: true },
    });
    if (accounts.length !== 2) {
      return NextResponse.json(
        { error: "One or both ledger accounts were not found on this organization" },
        { status: 404 }
      );
    }
    if (accounts.some((a) => a.archived)) {
      return NextResponse.json(
        { error: "One or both ledger accounts are archived and can no longer be used in a transfer" },
        { status: 409 }
      );
    }

    const amountSmallestUnit = toSmallestUnit(amount);
    const referenceId = nanoid();

    const { debit, credit } = await transferBetweenLedgerAccounts(
      fromLedgerAccountId,
      toLedgerAccountId,
      amountSmallestUnit,
      "INTERNAL_TRANSFER",
      referenceId
    );

    return NextResponse.json({
      referenceId,
      debit: { ledgerAccountId: debit.ledgerAccountId, balanceAfter: toDecimalString(debit.balanceAfter) },
      credit: { ledgerAccountId: credit.ledgerAccountId, balanceAfter: toDecimalString(credit.balanceAfter) },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof BucketPermissionError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof LedgerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[ledger/transfer] failed", err);
    return NextResponse.json({ error: "Transfer failed" }, { status: 500 });
  }
}
