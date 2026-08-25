// lib/insights/nlQuery/capabilities.ts
//
// Single source of truth for "what can the NL query engine answer."
// Used two ways:
//   1. Fed into the translator's system prompt (translate.ts) so the
//      LLM only ever picks from intents that are actually implemented,
//      instead of inventing one.
//   2. Exposed to the product surface (e.g. a GET on the query route,
//      or an empty-state screen) as example prompts / suggested
//      functionality — directly addresses "suggest different available
//      functionalities... based on the available data."
//
// Keep in sync with types.ts (one entry per NlQueryIntentName) and
// queries.ts/answer.ts (the implementation).

import type { NlQueryIntentName } from "./types";

export interface NlQueryCapability {
  intent: NlQueryIntentName;
  title: string;
  description: string;
  exampleQuestions: string[];
}

export const NL_QUERY_CAPABILITIES: NlQueryCapability[] = [
  {
    intent: "spend_by_category",
    title: "Spend by category",
    description: "Breaks down outgoing (or incoming) money by category over a time period.",
    exampleQuestions: [
      "What did I spend the most on this month?",
      "Show my top spending categories last quarter",
      "Where does most of my income come from this year?",
    ],
  },
  {
    intent: "top_counterparties",
    title: "Top counterparties",
    description: "Ranks who you paid the most, or who paid you the most, over a time period.",
    exampleQuestions: [
      "Who did I transfer the most to this month?",
      "Who paid me the most last quarter?",
      "Top 5 vendors I've paid this year",
    ],
  },
  {
    intent: "biggest_transaction",
    title: "Biggest single transaction",
    description: "Finds the single largest payment or deposit in a period, optionally by category or counterparty.",
    exampleQuestions: [
      "What's the biggest deposit I got this month?",
      "What was my largest payment last month?",
      "Biggest payroll transaction this year",
    ],
  },
  {
    intent: "totals",
    title: "Totals / net flow",
    description: "Total money in, out, or net for a period, optionally filtered by category or counterparty.",
    exampleQuestions: [
      "How much did I spend last month?",
      "What's my net cash flow this quarter?",
      "How much have I received from Acme Freight this year?",
    ],
  },
  {
    intent: "trend",
    title: "Inflow/outflow trend",
    description: "Shows how money in vs. out has moved day by day, week by week, or month by month.",
    exampleQuestions: [
      "Show my spending trend over the last 90 days",
      "How has my income changed month to month this year?",
    ],
  },
  {
    intent: "transaction_count",
    title: "Transaction counts",
    description: "Counts how many transactions matched a filter over a period.",
    exampleQuestions: [
      "How many payments did I send this month?",
      "How many times has 0xA1b2... paid me?",
    ],
  },
  {
    intent: "average_transaction",
    title: "Average transaction size",
    description: "Average outgoing or incoming transaction amount over a period.",
    exampleQuestions: [
      "What's my average payment size this month?",
      "Average deposit amount this year",
    ],
  },
  {
    intent: "counterparty_history",
    title: "Look up a wallet, username, or contact",
    description: "Full activity summary for one specific wallet address, username, or saved contact.",
    exampleQuestions: [
      "What's my history with 0xA1b2C3...?",
      "Show me everything with @acme-freight",
      "How much business have I done with Acme Freight?",
    ],
  },
  {
    intent: "anomalies_query",
    title: "Unusual activity",
    description: "Surfaces flagged large or first-time payments worth a second look.",
    exampleQuestions: [
      "Any unusual payments this month?",
      "Show my open spending anomalies",
    ],
  },
  {
    intent: "list_categories",
    title: "Available categories",
    description: "Lists the spending categories tracked for your org.",
    exampleQuestions: ["What categories do you track?"],
  },
];

export function listCapabilitySummaries(): string {
  return NL_QUERY_CAPABILITIES
    .map((c) => `- ${c.title}: ${c.description} (e.g. "${c.exampleQuestions[0]}")`)
    .join("\n");
}

/** Random-ish sample for "you could also ask" nudges in answer.ts. Deterministic (no Math.random) so responses are stable in tests. */
export function suggestRelated(exclude: NlQueryIntentName, count = 2): NlQueryCapability[] {
  return NL_QUERY_CAPABILITIES.filter((c) => c.intent !== exclude).slice(0, count);
}