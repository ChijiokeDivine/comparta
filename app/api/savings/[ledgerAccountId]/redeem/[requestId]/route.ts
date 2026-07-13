// app/api/savings/[ledgerAccountId]/redeem/[requestId]/route.ts
//
// GET: poll a single redemption request's status — the endpoint the UI
// polls to flip a "Processing…" indicator to "Done" (or surface a
// failure) after POSTing a redemption. Any authenticated org member.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { prisma } from "@/lib/db/prisma";
import { serializeYieldRedemptionRequest } from "@/lib/savings/serialize";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ledgerAccountId: string; requestId: string }> }
) {
  try {
    const { ledgerAccountId, requestId } = await params;
    const { orgId } = await requireAuth();

    const request = await prisma.yieldRedemptionRequest.findFirst({
      where: { id: requestId, ledgerAccountId, ledgerAccount: { orgId } },
    });
    if (!request) {
      return NextResponse.json({ error: "Redemption request not found" }, { status: 404 });
    }

    return NextResponse.json({ redemptionRequest: serializeYieldRedemptionRequest(request) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[savings/:ledgerAccountId/redeem/:requestId] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}