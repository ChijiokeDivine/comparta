// lib/identity/username.ts
//
// Validation and format rules for Comparta usernames (the $cashtag-style
// handle: comparta.app/@acme). Two invariants matter most here:
//
//   1. Username format and Arc-address format never overlap. Addresses are
//      always "0x" + 40 hex chars; usernames can never start with "0x".
//      That prefix rule alone guarantees no valid username is ever
//      confusable with a truncated/malformed address, and vice versa —
//      lib/identity/resolver.ts relies on this to route without ambiguity.
//   2. Lookups are always case-insensitive; usernames are normalized to
//      lowercase before every comparison and before storage.

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export class InvalidUsernameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsernameError";
  }
}

/** Lowercases and trims — the canonical form stored and compared everywhere. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Throws InvalidUsernameError with a specific, user-facing reason if the
 * (already-normalized) username fails format rules. Does NOT check
 * uniqueness or the denylist — see checkUsernameAvailable in resolver.ts's
 * caller (the claim route) for the full pipeline.
 */
export function assertValidUsernameFormat(normalized: string): void {
  if (normalized.length < 3 || normalized.length > 20) {
    throw new InvalidUsernameError("Username must be between 3 and 20 characters.");
  }
  if (normalized.startsWith("0x")) {
    throw new InvalidUsernameError(
      "Username cannot start with \"0x\" — that prefix is reserved for wallet addresses."
    );
  }
  if (!USERNAME_REGEX.test(normalized)) {
    throw new InvalidUsernameError(
      "Username may only contain lowercase letters, numbers, and underscores."
    );
  }
}

/**
 * Denylist check, v1: a simple wordlist. Blocks impersonation of common
 * brand/platform names and a short list of offensive terms. Matches
 * substrings too (e.g. "official_circle" is blocked because it contains
 * "circle"), since a bare exact-match list is trivially bypassed with
 * padding characters.
 *
 * This is intentionally coarse for v1 — false positives are cheap (the
 * person picks a different handle), false negatives are the expensive
 * failure mode (brand impersonation reaching real users).
 */
const RESERVED_SUBSTRINGS = [
  // Comparta itself / platform terms
  "comparta",
  "admin",
  "support",
  "official",
  "moderator",
  "staff",
  // Payment/crypto platforms and issuers commonly targeted for impersonation
  "circle",
  "usdc",
  "paypal",
  "venmo",
  "cashapp",
  "stripe",
  "coinbase",
  "binance",
  "metamask",
  "tether",
  "visa",
  "mastercard",
  "arcblockchain",
  // A minimal offensive-terms guard; extend via a real moderation list
  // before relying on this in production.
  "fuck",
  "shit",
  "nigger",
  "faggot",
];

export function isUsernameDenylisted(normalized: string): boolean {
  return RESERVED_SUBSTRINGS.some((term) => normalized.includes(term));
}

/**
 * Full validation pipeline for a claim attempt: format, then denylist.
 * Throws InvalidUsernameError with a specific reason on any failure.
 * Does not check database uniqueness — that's a separate, DB-backed step
 * in the claim route (format/denylist checks are cheap and synchronous;
 * uniqueness needs a query).
 */
export function validateUsernameForClaim(raw: string): string {
  const normalized = normalizeUsername(raw);
  assertValidUsernameFormat(normalized);
  if (isUsernameDenylisted(normalized)) {
    throw new InvalidUsernameError(
      "This username isn't available. Please choose something else."
    );
  }
  return normalized;
}