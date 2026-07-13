// app/api/savings/[ledgerAccountId]/yield-history/route.ts
//
// GET: daily time series of deployed value / accrued yield, ready to
// feed directly into a chart component. Optional ?days=N (default 30).
// Any authenticated org member.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { getYieldHistory } from "@/lib/savings/overview";
import { BucketNotFoundError } from "@/lib/buckets/service";

export async function GET(req: Request, { params }: { params: Promise<{ ledgerAccountId: string }> }) {
  try {
    const { ledgerAccountId } = await params;
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const daysParam = Number(searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

    const history = await getYieldHistory(orgId, ledgerAccountId, days);
    return NextResponse.json({ yieldHistory: history });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof BucketNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[savings/:ledgerAccountId/yield-history] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}