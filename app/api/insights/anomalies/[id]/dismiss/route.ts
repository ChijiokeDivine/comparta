// app/api/insights/anomalies/[id]/dismiss/route.ts
import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { dismissAnomaly, serializeAnomaly, AnomalyNotFoundError } from "@/lib/insights/anomalies/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const anomaly = await dismissAnomaly(orgId, id);
    return NextResponse.json({ anomaly: serializeAnomaly(anomaly) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof AnomalyNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[insights] dismiss anomaly failed", err);
    return NextResponse.json({ error: "Failed to dismiss anomaly" }, { status: 500 });
  }
}