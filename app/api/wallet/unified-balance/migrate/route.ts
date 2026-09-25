// app/api/wallet/unified-balance/migrate/route.ts
//
// GET  — preview ledger vs Arc onchain gap (excess to debit).
// POST — apply user-selected bucket debits summing to excess.
//        Header: Idempotency-Key
//        Body: { allocations: [{ ledgerAccountId, amount }] }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import {
  previewLedgerOnchainGap,
  migrateLedgerToMatchOnchain,
  MigrateLedgerError,
} from "@/lib/transfers/migrateLedgerToOnchain";

const postSchema = z.object({
  allocations: z
    .array(
      z.object({
        ledgerAccountId: z.string().min(1),
        amount: z.string().min(1),
      })
    )
    .min(1),
});

export async function GET() {
  try {
    const { orgId } = await requireApprovedOrg();
    const preview = await previewLedgerOnchainGap(orgId);
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof MigrateLedgerError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error("[wallet/unified-balance/migrate] GET failed", err);
    return NextResponse.json({ error: "Failed to preview migration" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();
    const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Missing Idempotency-Key header." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await migrateLedgerToMatchOnchain(
      orgId,
      parsed.data.allocations,
      idempotencyKey
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof MigrateLedgerError) {
      const status = err.code === "NOTHING_TO_MIGRATE" ? 200 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[wallet/unified-balance/migrate] POST failed", err);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
