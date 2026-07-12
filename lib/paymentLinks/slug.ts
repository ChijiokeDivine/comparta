// lib/paymentLinks/slug.ts
//
// Generates the short, URL-safe slug used in /pay/[slug]. Same posture as
// the username claim flow (lib/identity/username.ts +
// app/api/username/claim/route.ts): the real uniqueness guarantee is the
// database's unique constraint on PaymentLink.slug, not a pre-check —
// this module just picks a good candidate and retries on collision.

import { customAlphabet } from "nanoid";

// Unambiguous alphabet: no 0/O, 1/I/l, so a slug read aloud or copied by
// hand is never misheard/mistyped into a different valid slug.
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const SLUG_LENGTH = 10;

const generateCandidate = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

export function generateSlugCandidate(): string {
  return generateCandidate();
}

const MAX_SLUG_ATTEMPTS = 5;

/**
 * Runs `attempt(slug)` with fresh candidate slugs until it succeeds,
 * retrying only on a unique-constraint violation (P2002) — any other
 * error from `attempt` propagates immediately. At 10 chars over a
 * 55-character alphabet the birthday-bound collision odds are
 * astronomically small; MAX_SLUG_ATTEMPTS exists purely to fail loudly
 * instead of looping forever if something is systematically wrong (e.g.
 * the alphabet/length constants were shrunk without updating this).
 */
export async function withUniqueSlug<T>(
  attempt: (slug: string) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_SLUG_ATTEMPTS; i++) {
    const slug = generateSlugCandidate();
    try {
      return await attempt(slug);
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to generate a unique payment link slug after ${MAX_SLUG_ATTEMPTS} attempts`,
    { cause: lastErr }
  );
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}