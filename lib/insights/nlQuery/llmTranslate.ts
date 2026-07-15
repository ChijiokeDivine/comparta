// lib/insights/nlQuery/llmTranslate.ts
//
// Translates a natural-language question into a StructuredQueryFilter
// via Groq. This is the ONLY function in the codebase allowed to turn
// free text into query parameters for this feature — everything
// downstream (lib/insights/nlQuery/executeQuery.ts) only ever accepts an
// already-validated StructuredQueryFilter, never a raw string.
//
// The LLM's job is narrow and mechanical: map words to the fixed schema.
// It never generates SQL, never sees full account numbers or secrets,
// and any output that doesn't validate against structuredQueryFilterSchema
// is treated as a translation failure (surfaced to the caller as "I
// couldn't understand that query" rather than guessed at).

import { getGroqClient, GROQ_JSON_COMPLETION_DEFAULTS } from "@/lib/groq/client";
import { structuredQueryFilterSchema, type StructuredQueryFilter } from "./schema";

export class NlQueryTranslationError extends Error {
  constructor(message = "Couldn't understand that query. Try rephrasing with a date range, amount, or recipient name.") {
    super(message);
    this.name = "NlQueryTranslationError";
  }
}

export interface TranslateNlQueryInput {
  question: string;
  /** The org's current category names, so "contractors" maps to the org's actual category, not a guess. */
  availableCategories: string[];
  /** Today's date, ISO — the LLM needs this to resolve nothing itself (relative ranges are resolved in code), but it helps the model reason about tense ("last quarter" vs "this quarter"). */
  todayIso: string;
}

const SCHEMA_DESCRIPTION = `{
  "direction": "IN" | "OUT" | null,
  "relativeRange": "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year" | "trailing_30_days" | "trailing_90_days" | null,
  "dateFrom": "<ISO date, only if relativeRange is null and an explicit date was mentioned>" | null,
  "dateTo": "<ISO date>" | null,
  "minAmount": "<decimal USDC string, only if a lower bound was mentioned>" | null,
  "maxAmount": "<decimal USDC string, only if an upper bound was mentioned>" | null,
  "counterpartyContains": "<a name/word fragment to match against recipient/memo, only if a specific person/company was mentioned>" | null,
  "categoryName": "<one of the org's exact category names, only if a category/type of spend was mentioned>" | null,
  "sortBy": "date_desc" | "date_asc" | "amount_desc" | "amount_asc",
  "limit": <integer 1-200, default 50>
}`;

export async function translateNlQuery(input: TranslateNlQueryInput): Promise<StructuredQueryFilter> {
  const systemPrompt =
    `You translate a small business owner's natural-language question about their USDC payment history into ` +
    `a structured JSON filter. Output ONLY a JSON object matching EXACTLY this shape (no extra fields, no prose):\n` +
    `${SCHEMA_DESCRIPTION}\n\n` +
    `Rules:\n` +
    `- Set a field to null (or omit it) if the question didn't mention it — never guess a value.\n` +
    `- "I paid" / "I sent" / money going out => direction "OUT". "I received" / "I was paid" => direction "IN".\n` +
    `- Use relativeRange for anything relative to today ("${input.todayIso}") like "last quarter" or "this month" — never compute dateFrom/dateTo yourself for a relative phrase.\n` +
    `- categoryName, if set, MUST be exactly one of these existing categories: ${input.availableCategories.map((c) => `"${c}"`).join(", ")}. If the question mentions a category-like word that doesn't match any of these, leave categoryName null instead of inventing one.\n` +
    `- "over $X" / "more than $X" => minAmount. "under $X" / "less than $X" => maxAmount.\n` +
    `- A person or company name mentioned as the payee/payer => counterpartyContains.`;

  try {
    const groq = getGroqClient();
    const completion = await groq.chat.completions.create({
      ...GROQ_JSON_COMPLETION_DEFAULTS,
      max_tokens: 300,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.question },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new NlQueryTranslationError();

    const parsedJson = JSON.parse(raw);
    const result = structuredQueryFilterSchema.safeParse(parsedJson);
    if (!result.success) {
      console.error("[groq] NL query translation produced an invalid filter shape", result.error.flatten());
      throw new NlQueryTranslationError();
    }

    return result.data;
  } catch (err) {
    if (err instanceof NlQueryTranslationError) throw err;
    console.error("[groq] NL query translation failed", err);
    throw new NlQueryTranslationError();
  }
}