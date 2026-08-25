// lib/insights/nlQuery/service.ts
//
// Public entrypoint used by app/api/insights/query/route.ts:
//   runNaturalLanguageQuery(orgId, question) -> NlQueryResponse
//
// Pipeline: translateQuestion (LLM, constrained JSON output validated by
// zod) -> resolve any counterparty/category names against real org data
// -> execute the matching deterministic Prisma query -> format a
// templated answer. Nothing downstream of translateQuestion trusts the
// LLM for numbers or for identity resolution — see translate.ts and
// resolveEntity.ts.

import { resolveInterval, IntervalParseError } from "./interval";
import { translateQuestion, NlQueryTranslationError } from "./translate";
import { resolveCounterparty, resolveCategory } from "./resolveEntity";
import * as queries from "./queries";
import * as answer from "./answer";
import type { NlQueryResponse } from "./answer";

export { NlQueryTranslationError };

/**
 * Exhaustiveness guard for the intent switch below. The parameter type
 * is `never` — if a new NlQueryIntent variant is added to types.ts
 * without a matching `case` in the switch, this call stops compiling
 * (TS can no longer narrow `intent` to `never` at the default branch),
 * so the gap gets caught at build time instead of silently falling
 * through here at runtime. Unlike `const x: never = intent`, the value
 * is actually consumed (thrown), so it's never flagged as unused.
 */
function assertNever(intent: never): never {
  console.error("[insights] nlQuery: unhandled intent reached assertNever", intent);
  throw new NlQueryTranslationError("Couldn't understand that question — try rephrasing it.");
}

export async function runNaturalLanguageQuery(orgId: string, question: string): Promise<NlQueryResponse> {
  const intent = await translateQuestion(question);

  if (intent.intent === "unsupported") {
    return answer.answerUnsupported(question, intent.reason);
  }

  if (intent.intent === "list_categories") {
    const categories = await queries.getActiveCategoryNames(orgId);
    return answer.answerCategoryList(question, categories);
  }

  let interval;
  try {
    interval = resolveInterval(intent.interval, new Date());
  } catch (err) {
    if (err instanceof IntervalParseError) {
      throw new NlQueryTranslationError(err.message);
    }
    throw err;
  }

  // Resolve any named category/counterparty up front — shared by
  // several intents below.
  const categoryMatch = intent.categoryName ? await resolveCategory(orgId, intent.categoryName) : null;
  if (intent.categoryName && !categoryMatch) {
    return answer.answerNotFound(question, intent, `a category matching "${intent.categoryName}"`);
  }

  const counterpartyMatch =
    "counterparty" in intent && intent.counterparty ? await resolveCounterparty(orgId, intent.counterparty) : null;
  if ("counterparty" in intent && intent.counterparty && !counterpartyMatch) {
    return answer.answerNotFound(question, intent, `a wallet, contact, or username matching "${intent.counterparty}"`);
  }

  switch (intent.intent) {
    case "spend_by_category": {
      const rows = await queries.getSpendByCategory(orgId, interval, intent.direction, intent.limit ?? 5);
      return answer.answerSpendByCategory(question, interval.label, intent.direction, rows);
    }

    case "top_counterparties": {
      const rows = await queries.getTopCounterparties(orgId, interval, intent.direction, intent.limit ?? 5, categoryMatch?.id);
      const labeled = await Promise.all(
        rows.map(async (r) => {
          const resolved = await resolveCounterparty(orgId, r.counterpartyAddress);
          return { ...r, label: resolved?.label ?? r.counterpartyAddress };
        })
      );
      return answer.answerTopCounterparties(question, interval.label, intent.direction, labeled);
    }

    case "biggest_transaction": {
      const tx = await queries.getBiggestTransaction(orgId, interval, intent.direction, {
        categoryId: categoryMatch?.id,
        counterpartyAddress: counterpartyMatch?.address,
      });
      const label = tx ? (await resolveCounterparty(orgId, tx.counterpartyAddress))?.label ?? tx.counterpartyAddress : "";
      return answer.answerBiggestTransaction(question, interval.label, intent.direction, tx, label);
    }

    case "totals": {
      const totals = await queries.getTotals(orgId, interval, {
        categoryId: categoryMatch?.id,
        counterpartyAddress: counterpartyMatch?.address,
      });
      const scopeLabel = counterpartyMatch?.label ?? categoryMatch?.name;
      return answer.answerTotals(question, interval.label, totals, scopeLabel);
    }

    case "trend": {
      const buckets = await queries.getTrend(orgId, interval, intent.granularity);
      return answer.answerTrend(question, interval.label, intent.granularity, buckets);
    }

    case "transaction_count": {
      const count = await queries.getTransactionCount(orgId, interval, intent.direction, {
        categoryId: categoryMatch?.id,
        counterpartyAddress: counterpartyMatch?.address,
      });
      return answer.answerTransactionCount(question, interval.label, count, intent.direction);
    }

    case "average_transaction": {
      const result = await queries.getAverageTransaction(orgId, interval, intent.direction, categoryMatch?.id);
      return answer.answerAverage(question, interval.label, intent.direction, result);
    }

    case "counterparty_history": {
      // Schema guarantees `counterparty` is present for this intent;
      // resolution failure already returned above.
      const entity = counterpartyMatch!;
      const history = await queries.getCounterpartyHistory(orgId, interval, entity.address);
      return answer.answerCounterpartyHistory(question, interval.label, entity, history);
    }

    case "anomalies_query": {
      // Reuses the existing anomalies service rather than duplicating
      // its query — see lib/insights/anomalies/service.ts.
      const { listAnomalies, serializeAnomaly } = await import("@/lib/insights/anomalies/service");
      const anomalies = await listAnomalies(orgId, intent.status === "ALL" ? {} : { status: intent.status as "OPEN" | "DISMISSED" });
      const serialized = anomalies.map(serializeAnomaly);
      return {
        question,
        answer: serialized.length
          ? `${serialized.length} ${intent.status === "ALL" ? "" : intent.status.toLowerCase() + " "}anomal${serialized.length === 1 ? "y" : "ies"} found. Most recent: ${serialized[0].message}`
          : `No ${intent.status === "ALL" ? "" : intent.status.toLowerCase() + " "}anomalies found.`,
        interpretedAs: `anomalies_query (${intent.status})`,
        data: serialized,
        suggestions: [],
      };
    }

    default:
      return assertNever(intent);
  }
}