// lib/insights/nlQuery/service.ts
//
// Orchestrates the natural-language query feature end to end:
// translate (LLM, constrained to the fixed schema) -> execute
// (Prisma, never raw SQL) -> return both the results AND the resolved
// filter, so a UI can show "Searched for: payments to Sarah over $500,
// last quarter" as a confirmation the translation was reasonable.

import { listActiveCategories } from "@/lib/insights/categorization/seed";
import { translateNlQuery, NlQueryTranslationError } from "./llmTranslate";
import { executeStructuredQuery, type NlQueryResult } from "./executeQuery";
import type { StructuredQueryFilter } from "./schema";

export { NlQueryTranslationError };

export interface RunNlQueryResult extends NlQueryResult {
  interpretedFilter: StructuredQueryFilter;
  question: string;
}

export async function runNaturalLanguageQuery(
  orgId: string,
  question: string
): Promise<RunNlQueryResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new NlQueryTranslationError("Type a question first — e.g. \"payments to Sarah over $500 last quarter.\"");
  }

  const categories = await listActiveCategories(orgId);

  const filter = await translateNlQuery({
    question: trimmed,
    availableCategories: categories.map((c) => c.name),
    todayIso: new Date().toISOString().slice(0, 10),
  });

  const result = await executeStructuredQuery(orgId, filter);

  return { ...result, interpretedFilter: filter, question: trimmed };
}