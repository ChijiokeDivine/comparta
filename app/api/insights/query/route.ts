// app/api/insights/query/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { runNaturalLanguageQuery, NlQueryTranslationError } from "@/lib/insights/nlQuery/service";

const querySchema = z.object({
  question: z.string().min(1, "Ask a question first"),
});

export async function POST(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const body = await req.json().catch(() => null);
    const parsed = querySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const result = await runNaturalLanguageQuery(orgId, parsed.data.question);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof NlQueryTranslationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[insights] query failed", err);
    return NextResponse.json({ error: "Couldn't answer that question right now" }, { status: 500 });
  }
}