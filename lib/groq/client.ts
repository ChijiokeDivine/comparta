// lib/groq/client.ts
//
// Thin wrapper over the Groq SDK (OpenAI-compatible chat completions,
// low-latency inference). Every LLM-backed feature in Phase 9 goes
// through this one client rather than instantiating `Groq` ad hoc, so
// the model choice and API key wiring only need to be correct in one
// place.
//
// SECURITY / PRIVACY CONSTRAINT — applies to every caller of this
// client, not just this file: NEVER send full account numbers, wallet
// private keys, Circle entity secrets, or any other credential-shaped
// value to the Groq API. Only transaction METADATA needed for the
// specific task — amounts, memos, counterparty DISPLAY NAMES, dates —
// ever leaves this codebase via this client. See
// lib/insights/categorization/counterparty.ts for how a raw wallet
// address is turned into a safe display name (truncated, never the full
// address) before it's ever built into a prompt.

import Groq from "groq-sdk";
import { getEnv } from "@/lib/env";

let cached: Groq | null = null;

export function getGroqClient(): Groq {
  if (!cached) {
    cached = new Groq({ apiKey: getEnv().GROQ_API_KEY });
  }
  return cached;
}

// Groq-hosted, currently-available model. openai/gpt-oss-120b is a
// strong pick for structured-JSON tasks (categorization, NL-to-filter
// translation) at Groq's characteristic low latency. If it's ever
// deprecated/renamed on Groq's end, llama-3.3-70b-versatile is a solid
// drop-in alternative — both are configured here as the single place to
// swap, rather than hardcoded per call site.
export const GROQ_MODEL = "openai/gpt-oss-120b";

// Conservative shared defaults for the structured-output tasks in this
// phase (categorization, NL query translation): low temperature for
// consistency, and response_format forces valid JSON back rather than
// prose the caller then has to regex out.
export const GROQ_JSON_COMPLETION_DEFAULTS = {
  model: GROQ_MODEL,
  temperature: 0.1,
  response_format: { type: "json_object" as const },
};