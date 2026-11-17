// app/api/paj/orders/[id]/route.ts

import { NextResponse } from "next/server";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { getPajOrder } from "@/lib/paj/service";
import { pajErrorResponse } from "@/lib/paj/http";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await requireApprovedOrg();
    const { id } = await context.params;
    const sync = new URL(req.url).searchParams.get("sync") === "1";
    const order = await getPajOrder(orgId, id, { sync });
    return NextResponse.json({ order });
  } catch (err) {
    return pajErrorResponse(err);
  }
}
