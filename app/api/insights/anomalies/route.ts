// app/api/insights/anomalies/route.ts
import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { listAnomalies, serializeAnomaly } from "@/lib/insights/anomalies/service";
import type { AnomalyStatus } from "@/app/generated/prisma/client";

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam === "OPEN" || statusParam === "DISMISSED" ? (statusParam as AnomalyStatus) : undefined;

    const anomalies = await listAnomalies(orgId, { status });
    return NextResponse.json({ anomalies: anomalies.map(serializeAnomaly) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[insights] list anomalies failed", err);
    return NextResponse.json({ error: "Failed to list anomalies" }, { status: 500 });
  }
}