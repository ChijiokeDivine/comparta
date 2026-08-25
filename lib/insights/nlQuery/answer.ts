// lib/insights/nlQuery/answer.ts
//
// Deliberately template-based rather than "hand the numbers back to the
// LLM to phrase" — for financial figures, a second LLM pass is a second
// chance to transcribe a number wrong. Every string here is built from
// values that came straight out of Prisma.

import type { NlQueryIntent } from "./types";
import { suggestRelated } from "./capabilities";
import type { ResolvedCounterparty } from "./resolveEntity";
import type {
  CategoryBreakdownRow,
  CounterpartyHistory,
  CounterpartyRow,
  SingleTransactionRow,
  TotalsResult,
  TrendBucket,
} from "./queries";

export interface NlQueryResponse {
  question: string;
  answer: string;
  interpretedAs: string; // short human-readable trace of how the question was understood
  data: unknown; // structured payload for UI tables/charts — shape depends on intent
  suggestions: { title: string; example: string }[];
}

function money(amount: string): string {
  return `${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function suggestionsFor(intent: NlQueryIntent["intent"]): { title: string; example: string }[] {
  return suggestRelated(intent).map((c) => ({ title: c.title, example: c.exampleQuestions[0] }));
}

export function answerNotFound(question: string, intent: NlQueryIntent, what: string): NlQueryResponse {
  return {
    question,
    answer: `I couldn't find ${what}. Double-check the spelling, or try the wallet address directly.`,
    interpretedAs: intent.intent,
    data: null,
    suggestions: suggestionsFor(intent.intent),
  };
}

export function answerUnsupported(question: string, reason: string): NlQueryResponse {
  return {
    question,
    answer: reason,
    interpretedAs: "unsupported",
    data: null,
    suggestions: suggestRelated("unsupported", 3).map((c) => ({
      title: c.title,
      example: c.exampleQuestions[0],
    })),
  };
}

export function answerSpendByCategory(
  question: string,
  intervalLabel: string,
  direction: "IN" | "OUT",
  rows: CategoryBreakdownRow[]
): NlQueryResponse {
  const verb = direction === "OUT" ? "spent" : "received";
  if (rows.length === 0) {
    return {
      question,
      answer: `You didn't have any categorized ${direction === "OUT" ? "spending" : "income"} ${intervalLabel}.`,
      interpretedAs: `spend_by_category (${direction}, ${intervalLabel})`,
      data: rows,
      suggestions: suggestionsFor("spend_by_category"),
    };
  }
  const top = rows[0];
  const list = rows.map((r, i) => `${i + 1}. ${r.categoryName} — ${money(r.totalAmount)} (${r.transactionCount} tx)`).join("\n");
  return {
    question,
    answer: `You ${verb} the most on ${top.categoryName} ${intervalLabel}: ${money(top.totalAmount)} across ${top.transactionCount} transaction${top.transactionCount === 1 ? "" : "s"}.\n\nTop categories:\n${list}`,
    interpretedAs: `spend_by_category (${direction}, ${intervalLabel})`,
    data: rows,
    suggestions: suggestionsFor("spend_by_category"),
  };
}

export function answerTopCounterparties(
  question: string,
  intervalLabel: string,
  direction: "IN" | "OUT",
  rows: (CounterpartyRow & { label: string })[]
): NlQueryResponse {
  const verb = direction === "OUT" ? "paid" : "were paid by";
  if (rows.length === 0) {
    return {
      question,
      answer: `You didn't have any ${direction === "OUT" ? "outgoing payments" : "incoming payments"} ${intervalLabel}.`,
      interpretedAs: `top_counterparties (${direction}, ${intervalLabel})`,
      data: rows,
      suggestions: suggestionsFor("top_counterparties"),
    };
  }
  const top = rows[0];
  const list = rows.map((r, i) => `${i + 1}. ${r.label} — ${money(r.totalAmount)} (${r.transactionCount} tx)`).join("\n");
  return {
    question,
    answer: `You ${verb} ${top.label} the most ${intervalLabel}: ${money(top.totalAmount)} across ${top.transactionCount} transaction${top.transactionCount === 1 ? "" : "s"}.\n\n${list}`,
    interpretedAs: `top_counterparties (${direction}, ${intervalLabel})`,
    data: rows,
    suggestions: suggestionsFor("top_counterparties"),
  };
}

export function answerBiggestTransaction(
  question: string,
  intervalLabel: string,
  direction: "IN" | "OUT",
  tx: SingleTransactionRow | null,
  label: string
): NlQueryResponse {
  if (!tx) {
    return {
      question,
      answer: `No ${direction === "OUT" ? "payments" : "deposits"} found ${intervalLabel}.`,
      interpretedAs: `biggest_transaction (${direction}, ${intervalLabel})`,
      data: null,
      suggestions: suggestionsFor("biggest_transaction"),
    };
  }
  const verb = direction === "OUT" ? "payment" : "deposit";
  const category = tx.categoryName ? ` (${tx.categoryName})` : "";
  return {
    question,
    answer: `Your biggest ${verb} ${intervalLabel} was ${money(tx.amount)} ${direction === "OUT" ? "to" : "from"} ${label}${category} on ${fmtDate(tx.createdAt)}.`,
    interpretedAs: `biggest_transaction (${direction}, ${intervalLabel})`,
    data: tx,
    suggestions: suggestionsFor("biggest_transaction"),
  };
}

export function answerTotals(question: string, intervalLabel: string, totals: TotalsResult, scopeLabel?: string): NlQueryResponse {
  const scope = scopeLabel ? ` with ${scopeLabel}` : "";
  return {
    question,
    answer: `${intervalLabel[0].toUpperCase()}${intervalLabel.slice(1)}${scope}: received ${money(totals.totalIn)}, sent ${money(totals.totalOut)}, net ${money(totals.net)} across ${totals.transactionCount} transaction${totals.transactionCount === 1 ? "" : "s"}.`,
    interpretedAs: `totals (${intervalLabel})`,
    data: totals,
    suggestions: suggestionsFor("totals"),
  };
}

export function answerTransactionCount(question: string, intervalLabel: string, count: number, direction: "IN" | "OUT" | "BOTH"): NlQueryResponse {
  const what = direction === "IN" ? "incoming transactions" : direction === "OUT" ? "outgoing transactions" : "transactions";
  return {
    question,
    answer: `You had ${count} ${what} ${intervalLabel}.`,
    interpretedAs: `transaction_count (${direction}, ${intervalLabel})`,
    data: { count },
    suggestions: suggestionsFor("transaction_count"),
  };
}

export function answerAverage(
  question: string,
  intervalLabel: string,
  direction: "IN" | "OUT",
  result: { average: string; transactionCount: number } | null
): NlQueryResponse {
  if (!result) {
    return {
      question,
      answer: `No ${direction === "OUT" ? "payments" : "deposits"} found ${intervalLabel} to average.`,
      interpretedAs: `average_transaction (${direction}, ${intervalLabel})`,
      data: null,
      suggestions: suggestionsFor("average_transaction"),
    };
  }
  return {
    question,
    answer: `Your average ${direction === "OUT" ? "payment" : "deposit"} ${intervalLabel} was ${money(result.average)}, across ${result.transactionCount} transactions.`,
    interpretedAs: `average_transaction (${direction}, ${intervalLabel})`,
    data: result,
    suggestions: suggestionsFor("average_transaction"),
  };
}

export function answerCounterpartyHistory(
  question: string,
  intervalLabel: string,
  entity: ResolvedCounterparty,
  history: CounterpartyHistory
): NlQueryResponse {
  const { totals, recentTransactions } = history;
  if (totals.transactionCount === 0) {
    return {
      question,
      answer: `No activity with ${entity.label} ${intervalLabel}.`,
      interpretedAs: `counterparty_history (${intervalLabel})`,
      data: history,
      suggestions: suggestionsFor("counterparty_history"),
    };
  }
  const recentList = recentTransactions
    .slice(0, 5)
    .map((tx) => `- ${fmtDate(tx.createdAt)}: ${money(tx.amount)}${tx.categoryName ? ` (${tx.categoryName})` : ""}`)
    .join("\n");
  return {
    question,
    answer: `With ${entity.label} ${intervalLabel}: received ${money(totals.totalIn)}, sent ${money(totals.totalOut)}, net ${money(totals.net)} across ${totals.transactionCount} transaction${totals.transactionCount === 1 ? "" : "s"}.\n\nRecent:\n${recentList}`,
    interpretedAs: `counterparty_history (${entity.label}, ${intervalLabel})`,
    data: history,
    suggestions: suggestionsFor("counterparty_history"),
  };
}

export function answerCategoryList(question: string, categories: string[]): NlQueryResponse {
  return {
    question,
    answer: categories.length
      ? `Categories currently tracked: ${categories.join(", ")}.`
      : "No categories are set up for your org yet.",
    interpretedAs: "list_categories",
    data: categories,
    suggestions: suggestionsFor("list_categories"),
  };
}

export function answerTrend(question: string, intervalLabel: string, granularity: "day" | "week" | "month", buckets: TrendBucket[]): NlQueryResponse {
  if (buckets.length === 0) {
    return {
      question,
      answer: `No transaction activity ${intervalLabel}.`,
      interpretedAs: `trend (${granularity}, ${intervalLabel})`,
      data: buckets,
      suggestions: suggestionsFor("trend"),
    };
  }
  const totalIn = buckets.reduce((sum, b) => sum + Number(b.totalIn), 0);
  const totalOut = buckets.reduce((sum, b) => sum + Number(b.totalOut), 0);
  const recent = buckets
    .slice(-6)
    .map((b) => `- ${b.label}: in ${money(b.totalIn)}, out ${money(b.totalOut)}`)
    .join("\n");
  return {
    question,
    answer: `Over ${intervalLabel} (by ${granularity}): received ${money(totalIn.toFixed(2))} total, sent ${money(totalOut.toFixed(2))} total, across ${buckets.length} ${granularity} period${buckets.length === 1 ? "" : "s"}.\n\n${recent}`,
    interpretedAs: `trend (${granularity}, ${intervalLabel})`,
    data: buckets,
    suggestions: suggestionsFor("trend"),
  };
}