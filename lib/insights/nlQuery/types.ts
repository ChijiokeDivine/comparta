// lib/insights/nlQuery/types.ts
//
// The NL query engine never lets an LLM generate SQL/Prisma directly
// against org financial data. Instead the LLM's ONLY job is to translate
// a free-text question into one of a fixed set of "intents" below (a
// small structured DSL), which this module defines and validates with
// zod. Execution (queries.ts) then runs deterministic, parameterized
// Prisma queries per intent — so a prompt-injected or hallucinated
// question can, at worst, pick the wrong intent or wrong filter, never
// run an arbitrary query. Every numeric figure in the final answer comes
// from Prisma, never from the LLM.
//
// Adding a new supported question type = add a variant here + a
// matching branch in queries.ts + answer.ts, and add it to
// capabilities.ts so the translator (and product surfaces) know it
// exists.

import { z } from "zod";

export const intervalKindSchema = z.enum([
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "year_to_date",
  "all_time",
  "custom",
]);
export type IntervalKind = z.infer<typeof intervalKindSchema>;

export const intervalInputSchema = z.object({
  kind: intervalKindSchema,
  // Only read when kind === "custom". ISO 8601 date strings (YYYY-MM-DD
  // or full timestamp) — see interval.ts#resolveInterval for parsing.
  from: z.string().optional(),
  to: z.string().optional(),
});
export type IntervalInput = z.infer<typeof intervalInputSchema>;

// Resolved, ready-to-query interval — always concrete Dates.
export interface ResolvedInterval {
  from: Date;
  to: Date;
  label: string; // human-readable, e.g. "this month (Aug 1–25, 2026)"
}

export const directionSchema = z.enum(["IN", "OUT", "BOTH"]);
export type QueryDirection = z.infer<typeof directionSchema>;

// Shared filters every intent accepts. All optional — the LLM only
// fills in what the question actually specifies.
const baseFields = {
  interval: intervalInputSchema.optional(),
  // Raw text as the user wrote it — "0xabc...", "@acme", "Acme Freight".
  // Resolved against Contact/Organization by resolveEntity.ts, NOT here.
  counterparty: z.string().optional(),
  // Raw category name as the user wrote it — "Payroll", "software" etc.
  // Resolved against TransactionCategory by resolveEntity.ts, NOT here.
  categoryName: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
};

export const spendByCategoryIntent = z.object({
  intent: z.literal("spend_by_category"),
  ...baseFields,
  // "what did I spend the most on" -> OUT. Rarely IN ("what categories
  // is my income coming from") but the schema allows it.
  direction: directionSchema.exclude(["BOTH"]).default("OUT"),
});

export const topCounterpartiesIntent = z.object({
  intent: z.literal("top_counterparties"),
  ...baseFields,
  // OUT = "who did I pay/transfer to the most". IN = "who paid me the most".
  direction: directionSchema.exclude(["BOTH"]),
});

export const biggestTransactionIntent = z.object({
  intent: z.literal("biggest_transaction"),
  ...baseFields,
  direction: directionSchema.exclude(["BOTH"]),
});

export const totalsIntent = z.object({
  intent: z.literal("totals"),
  ...baseFields,
  direction: directionSchema.default("BOTH"),
});

export const trendIntent = z.object({
  intent: z.literal("trend"),
  ...baseFields,
  direction: directionSchema.default("BOTH"),
  granularity: z.enum(["day", "week", "month"]).default("day"),
});

export const transactionCountIntent = z.object({
  intent: z.literal("transaction_count"),
  ...baseFields,
  direction: directionSchema.default("BOTH"),
});

export const averageTransactionIntent = z.object({
  intent: z.literal("average_transaction"),
  ...baseFields,
  direction: directionSchema.exclude(["BOTH"]).default("OUT"),
});

export const counterpartyHistoryIntent = z.object({
  intent: z.literal("counterparty_history"),
  ...baseFields,
  counterparty: z.string(), // required for this intent
  direction: directionSchema.default("BOTH"),
});

export const anomaliesQueryIntent = z.object({
  intent: z.literal("anomalies_query"),
  ...baseFields,
  status: z.enum(["OPEN", "DISMISSED", "ALL"]).default("OPEN"),
});

export const listCategoriesIntent = z.object({
  intent: z.literal("list_categories"),
});

// The translator picks this when the question is understandable but
// asks for something the data model genuinely doesn't support (e.g.
// bank balance, tax liability, future projections). `reason` is shown
// to the user verbatim-ish, so keep it short and non-technical.
export const unsupportedIntent = z.object({
  intent: z.literal("unsupported"),
  reason: z.string(),
});

export const nlQueryIntentSchema = z.discriminatedUnion("intent", [
  spendByCategoryIntent,
  topCounterpartiesIntent,
  biggestTransactionIntent,
  totalsIntent,
  trendIntent,
  transactionCountIntent,
  averageTransactionIntent,
  counterpartyHistoryIntent,
  anomaliesQueryIntent,
  listCategoriesIntent,
  unsupportedIntent,
]);
export type NlQueryIntent = z.infer<typeof nlQueryIntentSchema>;
export type NlQueryIntentName = NlQueryIntent["intent"];