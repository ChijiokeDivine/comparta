// lib/insights/categorization/llmCategorize.ts
//
// Calls Groq to suggest a category for one transaction that has no
// deterministic rule match (lib/insights/categorization/rules.ts).
// Output is STRICTLY constrained to the org's actual category name list
// — the LLM cannot invent a category that silently gets applied; any
// response outside the allow-list is clamped to "Other" with zero
// confidence, which routes it to the manual-confirmation queue rather
// than auto-applying a made-up label.
//
// PRIVACY: the only fields ever sent are amount, direction, a resolved
// DISPLAY NAME (never the raw address — see lib/insights/counterparty.ts),
// memo text, and date. No wallet addresses, no account numbers, no
// entity secrets, no other transactions' data.

import { z } from "zod";
import { getGroqClient, GROQ_JSON_COMPLETION_DEFAULTS } from "@/lib/groq/client";

export interface CategorizationLlmInput {
  /** Resolved display name — NEVER a raw wallet address. */
  counterpartyDisplayName: string;
  memo: string | null;
  /** Decimal string, e.g. "1250.00". */
  amount: string;
  direction: "IN" | "OUT";
  /** ISO date string. */
  date: string;
  /** The org's current category names — the LLM must choose exactly one of these. */
  availableCategories: string[];
}

export interface CategorizationLlmResult {
  categoryName: string;
  /** 0–10000 basis points. */
  confidenceBps: number;
  reasoning: string;
}

const llmResponseSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const FALLBACK_RESULT: CategorizationLlmResult = {
  categoryName: "Other",
  confidenceBps: 0,
  reasoning: "Automatic categorization was unavailable; needs manual review.",
};

export async function suggestCategoryViaLLM(
  input: CategorizationLlmInput
): Promise<CategorizationLlmResult> {
  const systemPrompt =
    `You categorize a small business's USDC payment transactions for a spend-analytics dashboard. ` +
    `Choose EXACTLY ONE category from this fixed list — never invent a new one: ` +
    `${input.availableCategories.map((c) => `"${c}"`).join(", ")}. ` +
    `If nothing else fits, use "Other". ` +
    `Respond with ONLY a JSON object, no other text, in exactly this shape: ` +
    `{"category": "<one of the exact names above>", "confidence": <number 0 to 1>, "reasoning": "<one short sentence>"}.`;

  const userPrompt = JSON.stringify({
    direction: input.direction,
    amount_usdc: input.amount,
    counterparty: input.counterpartyDisplayName,
    memo: input.memo ?? "(none)",
    date: input.date,
  });

  try {
    const groq = getGroqClient();
    const completion = await groq.chat.completions.create({
      ...GROQ_JSON_COMPLETION_DEFAULTS,
      max_tokens: 200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty completion");

    const parsed = llmResponseSchema.parse(JSON.parse(raw));

    // Hard allow-list enforcement — never trust the model to have
    // actually followed the prompt's constraint.
    const categoryName = input.availableCategories.includes(parsed.category)
      ? parsed.category
      : "Other";
    const confidenceBps = Math.max(0, Math.min(10000, Math.round(parsed.confidence * 10000)));

    return { categoryName, confidenceBps, reasoning: parsed.reasoning.slice(0, 500) };
  } catch (err) {
    console.error("[groq] categorization suggestion failed, falling back to Other/0-confidence", err);
    return FALLBACK_RESULT;
  }
}