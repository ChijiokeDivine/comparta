// app/api/countries/route.ts
//
// Returns the Country catalog (seeded from REST Countries at deploy /
// first-sync time) with a `supported` flag derived from whether a fresh
// FxRate currently exists for the country's currency_code.
//
// Authenticated because it's only consumed by the user's own settings /
// onboarding forms — not a public marketing page.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { listSupportedCountries } from "@/lib/fx/valuation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const rows = await listSupportedCountries(new Date());
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[countries] list failed", err);
    return NextResponse.json({ error: "Failed to load countries" }, { status: 500 });
  }
}
