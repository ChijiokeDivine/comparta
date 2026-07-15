// lib/insights/nlQuery/schema.ts
//
// The FIXED, allow-listed shape every natural-language query must
// translate into. This is the entire security boundary for the NL-query
// feature: the LLM never sees or produces SQL, never talks to Postgres
// directly, and can only populate fields from this exact schema. Even a
// maximally adversarial or malformed LLM response can only ever produce
// a StructuredQueryFilter (or fail zod validation entirely) — there is
// no code path from an LLM response to a raw query string.

import { z } from "zod";

export const RELATIVE_RANGES = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "trailing_30_days",
  "trailing_90_days",
] as const;
export type RelativeRange = (typeof RELATIVE_RANGES)[number];

export const SORT_OPTIONS = ["date_desc", "date_asc", "amount_desc", "amount_asc"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

// Every field is optional/nullable — an unset field means "don't filter
// on this." The LLM is instructed (see llmTranslate.ts's system prompt)
// to omit or null out anything the query didn't mention rather than
// guess a value.
export const structuredQueryFilterSchema = z.object({
  direction: z.enum(["IN", "OUT"]).nullable().optional(),

  // Exactly one of relativeRange OR (dateFrom/dateTo) should be set —
  // relativeRange takes precedence if both are present (see
  // executeQuery.ts#resolveDateBounds). Absolute dates are ISO date
  // strings ("2026-04-01").
  relativeRange: z.enum(RELATIVE_RANGES).nullable().optional(),
  dateFrom: z.string().nullable().optional(),
  dateTo: z.string().nullable().optional(),

  // Decimal USDC strings, e.g. "500" or "500.00".
  minAmount: z.string().nullable().optional(),
  maxAmount: z.string().nullable().optional(),

  // Free-text fragment matched (case-insensitive) against the
  // counterparty's resolved display name (Contact/Payee) OR the raw
  // memo text — covers "payments to Sarah" and "anything mentioning
  // invoice #114" alike. NEVER matched against raw addresses directly.
  counterpartyContains: z.string().nullable().optional(),

  // Must exactly match one of the org's current TransactionCategory
  // names (validated against the real list in executeQuery.ts, not
  // trusted blindly from the LLM output) — covers "contractors",
  // "software spend", etc.
  categoryName: z.string().nullable().optional(),

  sortBy: z.enum(SORT_OPTIONS).default("date_desc"),
  limit: z.number().int().min(1).max(200).default(50),
});

export type StructuredQueryFilter = z.infer<typeof structuredQueryFilterSchema>;