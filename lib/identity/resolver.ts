// lib/identity/resolver.ts
//
// Resolves a "toIdentifier" — either a Comparta username (like a
// $cashtag) or a raw Arc address — into the actual destination address,
// plus org metadata when the identifier is one of ours. Every feature
// that sends, receives, invoices, or generates a payment link routes
// through resolve() rather than parsing identifiers itself, so username
// vs. address handling only needs to be correct in one place.
//
// Username and address formats never overlap by construction (see
// lib/identity/username.ts) — a syntactically valid string is always
// unambiguously one or the other, never both, never neither-shaped junk
// that could be misrouted.

import { prisma } from "@/lib/db/prisma";
import { normalizeUsername, assertValidUsernameFormat, InvalidUsernameError } from "./username";
import { isValidAddress, toChecksumAddress } from "./address";

export class ResolverError extends Error {
  constructor(message: string, public readonly code: ResolverErrorCode) {
    super(message);
    this.name = "ResolverError";
  }
}

export type ResolverErrorCode =
  | "MALFORMED_IDENTIFIER"
  | "USERNAME_NOT_FOUND"
  | "ORG_HAS_NO_WALLET";

export type ResolvedIdentifierType = "USERNAME" | "ADDRESS";

export interface ResolvedIdentity {
  type: ResolvedIdentifierType;
  /** The checksummed Arc address to actually send to / display. */
  address: string;
  /** Set when the identifier resolved to a known Comparta org. */
  orgId?: string;
  /** The org's legal name, for display — only set when orgId is set. */
  displayName?: string;
  /** The username that was resolved, normalized — only set for USERNAME lookups. */
  username?: string;
}

/**
 * Resolves a username OR a raw address to a destination address.
 *
 * Throws ResolverError (never returns a partial/ambiguous result) when:
 *   - the identifier matches neither a valid username nor a valid address
 *     shape at all (MALFORMED_IDENTIFIER)
 *   - it's shaped like a username but no org has claimed it
 *     (USERNAME_NOT_FOUND)
 *   - it resolves to a Comparta org that has no provisioned wallet yet —
 *     shouldn't happen post-KYB-approval, but guarded explicitly rather
 *     than surfacing a confusing null-address downstream (ORG_HAS_NO_WALLET)
 */
export async function resolve(identifierRaw: string): Promise<ResolvedIdentity> {
  const identifier = identifierRaw.trim();

  if (identifier.length === 0) {
    throw new ResolverError("Identifier cannot be empty.", "MALFORMED_IDENTIFIER");
  }

  // Address branch: anything shaped like "0x" + hex is treated as an
  // address, never as a username (usernames can never start with "0x").
  if (identifier.toLowerCase().startsWith("0x")) {
    if (!isValidAddress(identifier)) {
      throw new ResolverError(
        `"${identifier}" looks like a wallet address but isn't a valid one. Double-check for typos or a truncated address.`,
        "MALFORMED_IDENTIFIER"
      );
    }

    const checksummed = toChecksumAddress(identifier);

    // Enrich with org metadata if this happens to be one of our
    // custodied wallets — purely cosmetic (nicer confirmation UI), never
    // required for the resolution to succeed.
    const wallet = await prisma.wallet.findUnique({
      where: { arcAddress: checksummed },
      include: { organization: { select: { id: true, legalName: true } } },
    });

    return {
      type: "ADDRESS",
      address: checksummed,
      orgId: wallet?.organization.id,
      displayName: wallet?.organization.legalName,
    };
  }

  // Username branch.
  const normalized = normalizeUsername(identifier);
  try {
    assertValidUsernameFormat(normalized);
  } catch (err) {
    if (err instanceof InvalidUsernameError) {
      throw new ResolverError(
        `"${identifierRaw}" isn't a valid username or wallet address. ${err.message}`,
        "MALFORMED_IDENTIFIER"
      );
    }
    throw err;
  }

  const org = await prisma.organization.findUnique({
    where: { username: normalized },
    include: { wallets: { take: 1 } },
  });

  if (!org) {
    throw new ResolverError(
      `No account found for username "@${normalized}".`,
      "USERNAME_NOT_FOUND"
    );
  }

  const wallet = org.wallets[0];
  if (!wallet) {
    throw new ResolverError(
      `@${normalized}'s account doesn't have a wallet set up yet.`,
      "ORG_HAS_NO_WALLET"
    );
  }

  return {
    type: "USERNAME",
    address: wallet.arcAddress,
    orgId: org.id,
    displayName: org.legalName,
    username: normalized,
  };
}