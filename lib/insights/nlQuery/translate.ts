// lib/insights/nlQuery/translate.ts
//
// Translates a free-text question into one NlQueryIntent via the shared
// Groq client (see lib/groq/client.ts), using its json_object response
// format. Unlike forced tool-use, json_object mode only guarantees
// *syntactically valid JSON* back — not that it matches our intent
// schema's shape. So the zod parse below isn't a belt-and-suspenders
// extra here, it's THE enforcement point: it's the only thing standing
// between "the model returned some JSON" and "the app trusts this as a
// real query." Anything that fails validation degrades to `unsupported`
// rather than reaching queries.ts with an unchecked shape.
//
// Respects the privacy constraint in lib/groq/client.ts: the only thing
// sent to Groq here is the user's own question text (their input, not
// data pulled from our DB) plus the static capability list. No wallet
// addresses, amounts, or counterparty data from the database are ever
// included in this prompt — those are only ever looked up AFTER
// translation, in resolveEntity.ts/queries.ts, entirely server-side.

import { getGroqClient, GROQ_JSON_COMPLETION_DEFAULTS } from "@/lib/groq/client";
import { nlQueryIntentSchema, type NlQueryIntent } from "./types";
import { listCapabilitySummaries } from "./capabilities";

export class NlQueryTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NlQueryTranslationError";
  }
}

const INTENT_NAMES = [
  "spend_by_category",
  "top_counterparties",
  "biggest_transaction",
  "totals",
  "trend",
  "transaction_count",
  "average_transaction",
  "counterparty_history",
  "anomalies_query",
  "list_categories",
  "unsupported",
] as const;

// Spelled out in full since json_object mode won't enforce this shape
// for us — the model only has this prompt to go on.
const JSON_CONTRACT = `Respond with ONLY a single JSON object (no prose, no markdown fences) with this shape:

{
  "intent": one of ${JSON.stringify(INTENT_NAMES)},
  "direction": "IN" | "OUT" | "BOTH"            // omit if not applicable
  "interval": {                                  // omit to default to the last 30 days
    "kind": one of ["today","yesterday","this_week","last_week","this_month","last_month","this_year","last_year","last_7_days","last_30_days","last_90_days","year_to_date","all_time","custom"],
    "from": "YYYY-MM-DD",                        // ONLY when kind is "custom"
    "to": "YYYY-MM-DD"                           // ONLY when kind is "custom"
  },
  "counterparty": string,                        // raw wallet address, @username, or contact/company name mentioned — omit if none
  "categoryName": string,                        // raw category name mentioned — omit if none
  "limit": number,                               // e.g. "top 3" -> 3 — omit to use a sensible default
  "granularity": "day" | "week" | "month",       // only for intent "trend"
  "status": "OPEN" | "DISMISSED" | "ALL",        // only for intent "anomalies_query"
  "reason": string                               // ONLY when intent is "unsupported" — a short, friendly, plain-language reason
}

Only include the keys that are relevant to the chosen intent. Do not include null values — omit the key entirely instead.`;

function systemPrompt(now: Date): string {
  return [
    "You translate a business owner's plain-English question about their org's onchain payment activity into ONE structured query intent.",
    `Today's date is ${now.toISOString().slice(0, 10)}.`,
    "Supported question types:",
    listCapabilitySummaries(),
    "",
    JSON_CONTRACT,
    "",
    "Rules:",
    "- Extract counterparty/categoryName verbatim from the question — do not normalize, guess an ID, or invent one that wasn't said.",
    "- If a question could match a supported type but is missing a detail (e.g. no time period given), still pick that intent and omit interval — a default period is applied downstream.",
    "- If a question asks for something not covered by the supported types (e.g. bank balances, tax owed, future predictions, anything not about this org's onchain transaction history), use intent \"unsupported\" with a brief, friendly reason.",
  ].join("\n");
}

/** Strips ```json fences etc. in case the model wraps its output despite response_format. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : raw).trim();
}

/**
 * Calls the LLM to translate `question` into a validated NlQueryIntent.
 * Throws NlQueryTranslationError only for hard failures (empty question,
 * API error) — a valid-but-unanswerable or malformed-response question
 * comes back as an `unsupported` intent, not a thrown error, so the
 * caller can respond gracefully with suggestions instead of a 422.
 */
export async function translateQuestion(question: string, now: Date = new Date()): Promise<NlQueryIntent> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new NlQueryTranslationError("Ask a question first.");
  }

  let raw: string | null | undefined;
  try {
    const completion = await getGroqClient().chat.completions.create({
      ...GROQ_JSON_COMPLETION_DEFAULTS,
      messages: [
        { role: "system", content: systemPrompt(now) },
        { role: "user", content: trimmed },
      ],
    });
    raw = completion.choices[0]?.message?.content;
  } catch (err) {
    console.error("[insights] nlQuery translation call failed", err);
    throw new NlQueryTranslationError("Couldn't understand that question right now — try again in a moment.");
  }

  if (!raw) {
    throw new NlQueryTranslationError("Couldn't understand that question — try rephrasing it.");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJson(raw));
  } catch (err) {
    console.warn("[insights] nlQuery translation returned non-JSON", raw);
    return {
      intent: "unsupported",
      reason: "I wasn't able to work out exactly what you're asking — could you rephrase it?",
    };
  }

  const parsed = nlQueryIntentSchema.safeParse(candidate);
  if (!parsed.success) {
    // Valid JSON, but not a shape zod accepts (bad enum value, missing
    // a required field for that variant, etc.) — treat as unsupported
    // rather than surfacing a 500 or a raw zod error to the user.
    console.warn("[insights] nlQuery intent failed validation", parsed.error.flatten(), candidate);
    return {
      intent: "unsupported",
      reason: "I wasn't able to work out exactly what you're asking — could you rephrase it?",
    };
  }

  return parsed.data;
}