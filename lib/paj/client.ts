// lib/paj/client.ts
//
// The only module that talks HTTP to Paj. Everything else calls
// lib/paj/api.ts, which wraps these request helpers with endpoint-specific
// types.
//
// Auth model: every v2 request carries `x-api-key`. There is no
// per-user session — Paj scopes orders to the business behind the key.
// The key stays on the server; routes proxy the handful of reads the UI
// needs (rates, banks).

import { getEnv } from "@/lib/env";
import { getPajApiBaseUrl } from "./config";

const REQUEST_TIMEOUT_MS = 25_000;

export class PajApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown
  ) {
    super(message);
    this.name = "PajApiError";
  }
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const raw = record.message ?? record.error;
    if (Array.isArray(raw)) return raw.filter(Boolean).join(", ") || fallback;
    if (typeof raw === "string" && raw.trim()) return raw;
  }
  return fallback;
}

interface PajRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Do not throw on a 404 — return null instead. */
  allowNotFound?: boolean;
}

export async function pajRequest<T>(
  path: string,
  options: PajRequestOptions = {}
): Promise<T> {
  const apiKey = getEnv().PAJ_CASH_API_KEY;
  if (!apiKey) {
    throw new PajApiError("Paj is not configured.", 503);
  }

  const url = new URL(`${getPajApiBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new PajApiError("Paj took too long to respond. Try again.", 504);
    }
    throw new PajApiError(
      "Could not reach Paj right now. Try again in a moment.",
      503,
      err
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (options.allowNotFound && response.status === 404) return null as T;

  if (!response.ok) {
    throw new PajApiError(
      extractMessage(payload, `Paj request failed (${response.status}).`),
      response.status,
      payload
    );
  }

  return payload as T;
}
