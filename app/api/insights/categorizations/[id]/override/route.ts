// app/api/insights/categorizations/[id]/override/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import {
  overrideCategorization,
  CategorizationNotFoundError,
  InsightsValidationError,
} from "@/lib/insights/categorization/service";

const overrideSchema = z.object({
  categoryId: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();

    const body = await req.json().catch(() => null);
    const parsed = overrideSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const categorization = await overrideCategorization(orgId, id, parsed.data.categoryId);
    return NextResponse.json({ categorization });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof CategorizationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InsightsValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[insights] override categorization failed", err);
    return NextResponse.json({ error: "Failed to override categorization" }, { status: 500 });
  }
}