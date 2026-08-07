// app/api/insights/categorizations/pending/route.ts
import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { listPendingCategorizations } from "@/lib/insights/categorization/service";
import { toDecimalString } from "@/lib/circle/amount";

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const pending = await listPendingCategorizations(orgId);
    return NextResponse.json({
      categorizations: pending.map((c) => ({
        ...c,
        onchainTransaction: { ...c.onchainTransaction, amount: toDecimalString(c.onchainTransaction.amount) },
      })),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[insights] list pending categorizations failed", err);
    return NextResponse.json({ error: "Failed to load pending categorizations" }, { status: 500 });
  }
}