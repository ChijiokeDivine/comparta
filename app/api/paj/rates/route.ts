// app/api/paj/rates/route.ts
// Proxies Paj's live on/off ramp rates. Rates already include the
// business fee configured on the API key — never mark them up again.

import { NextResponse } from "next/server";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { getPajRates } from "@/lib/paj/api";
import { PAJ_CURRENCY } from "@/lib/config/pajChains";
import { pajErrorResponse } from "@/lib/paj/http";

export async function GET() {
  try {
    await requireApprovedOrg();
    const rates = await getPajRates(PAJ_CURRENCY);
    return NextResponse.json({
      currency: PAJ_CURRENCY,
      onRampRate: rates.onRampRate.rate,
      offRampRate: rates.offRampRate.rate,
      updatedAt: rates.onRampRate.createdAt,
    });
  } catch (err) {
    return pajErrorResponse(err);
  }
}
