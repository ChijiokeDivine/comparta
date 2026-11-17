// app/api/paj/orders/route.ts
// Lists bank ramp orders. `?sync=1` refreshes non-terminal orders from
// Paj (capped at five per call) so the UI stays current even if a webhook
// is missed.

import { NextResponse } from "next/server";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { listPajOrders } from "@/lib/paj/service";
import { pajErrorResponse } from "@/lib/paj/http";

export async function GET(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();
    const params = new URL(req.url).searchParams;
    const typeParam = params.get("type");
    const type =
      typeParam === "ONRAMP" || typeParam === "OFFRAMP" ? typeParam : undefined;

    const orders = await listPajOrders(orgId, {
      type,
      sync: params.get("sync") === "1",
    });
    return NextResponse.json({ orders });
  } catch (err) {
    return pajErrorResponse(err);
  }
}
