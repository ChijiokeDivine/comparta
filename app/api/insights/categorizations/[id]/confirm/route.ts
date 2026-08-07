// app/api/insights/categorizations/[id]/confirm/route.ts
import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { confirmCategorization, CategorizationNotFoundError } from "@/lib/insights/categorization/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const categorization = await confirmCategorization(orgId, id);
    return NextResponse.json({ categorization });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof CategorizationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[insights] confirm categorization failed", err);
    return NextResponse.json({ error: "Failed to confirm categorization" }, { status: 500 });
  }
}