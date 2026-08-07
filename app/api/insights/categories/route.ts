// app/api/insights/categories/route.ts
import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { listActiveCategories } from "@/lib/insights/categorization/seed";

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const categories = await listActiveCategories(orgId);
    return NextResponse.json({ categories });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[insights] list categories failed", err);
    return NextResponse.json({ error: "Failed to load categories" }, { status: 500 });
  }
}