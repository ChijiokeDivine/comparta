// app/api/fx/rates/route.ts
//
// Returns the currently-known USD → quote FX rates alongside metadata
// (currency name, symbol, freshness status).  Used by the frontend for
// places that need to display multiple currencies at once (e.g. a
// currency picker preview). The authenticated balance endpoint already
// embeds the user's single preferred valuation directly.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { getRatesResponse } from "@/lib/fx/valuation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const result = await getRatesResponse(new Date());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[fx/rates] get failed", err);
    return NextResponse.json({ error: "Failed to load rates" }, { status: 500 });
  }
}
