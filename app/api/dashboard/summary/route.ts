// app/api/dashboard/summary/route.ts
//
// Authenticated JSON endpoint returning the same DashboardSummary shape
// that the server-rendered dashboard page uses — so the client can
// re-fetch it after a realtime event without doing a full page reload.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { getDashboardSummary } from "@/lib/insights/dashboard/getDashboardSummary";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await getDashboardSummary(session.user.orgId);
  return NextResponse.json(summary);
}
