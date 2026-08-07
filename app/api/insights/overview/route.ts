// app/api/insights/overview/route.ts
//
// Wraps lib/insights/dashboard/queries.ts (spend-by-category +
// inflow/outflow trend) in a single call so the Insights page doesn't
// need two round trips for what's really one "here's your spending
// picture" screen. No route previously exposed these query functions at
// all — this one follows the same requireAuth() + zod + handleError
// shape every other route in this codebase uses (see app/api/contacts).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import {
  resolveRangePreset,
  getSpendByCategory,
  getInflowOutflowTrend,
  type RangePreset,
} from "@/lib/insights/dashboard/queries";

const querySchema = z.object({
  preset: z.enum(["current_month", "trailing_30_days", "trailing_90_days", "custom"]).default("trailing_30_days"),
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.enum(["IN", "OUT"]).default("OUT"),
  granularity: z.enum(["day", "week", "month"]).default("day"),
});

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      preset: url.searchParams.get("preset") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      direction: url.searchParams.get("direction") ?? undefined,
      granularity: url.searchParams.get("granularity") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const { preset, from, to, direction, granularity } = parsed.data;
    if (preset === "custom" && (!from || !to)) {
      return NextResponse.json({ error: "custom preset requires both from and to" }, { status: 400 });
    }

    let range;
    try {
      range = resolveRangePreset(preset as RangePreset, new Date(), from && to ? { from, to } : undefined);
    } catch {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const [spendByCategory, trend] = await Promise.all([
      getSpendByCategory(orgId, range, direction),
      getInflowOutflowTrend(orgId, range, granularity),
    ]);

    return NextResponse.json({ spendByCategory, trend });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[insights] overview failed", err);
    return NextResponse.json({ error: "Failed to load insights overview" }, { status: 500 });
  }
}