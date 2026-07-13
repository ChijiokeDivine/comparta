// lib/payroll/identifier.ts
//
// Identifier normalization for Payee.identifier — deliberately mirrors
// lib/contacts/service.ts#normalizeIdentifier (same username-vs-address
// inference rules as lib/identity/resolver.ts) rather than importing it,
// since Contact and Payee are separate rows with separate validation
// error types. Keeping the same rules is what makes a Contact ->
// createPayeeFromContact conversion (see payees.ts) never produce a
// Payee whose identifier resolve() would treat differently than the
// Contact it came from.

import type { IdentifierType } from "@/app/generated/prisma/client";
import { normalizeUsername, assertValidUsernameFormat, InvalidUsernameError } from "@/lib/identity/username";
import { isValidAddress, toChecksumAddress } from "@/lib/identity/address";

export class PayeeIdentifierFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayeeIdentifierFormatError";
  }
}

/**
 * Normalizes a raw identifier into its canonical stored form and infers
 * its type. Throws PayeeIdentifierFormatError if the identifier is
 * shaped like neither a valid username nor a valid address. This is a
 * pure format check — it does NOT check whether the identifier actually
 * resolves to a live account/wallet right now; use
 * lib/identity/resolver.ts#resolve for that (called at payroll
 * run-generation time, not here, since resolvability can change after a
 * Payee is created — see the identifierIssue flag on PayrollRunItem).
 */
export function normalizePayeeIdentifier(raw: string): { identifier: string; identifierType: IdentifierType } {
  const trimmed = raw.trim();

  if (trimmed.toLowerCase().startsWith("0x")) {
    if (!isValidAddress(trimmed)) {
      throw new PayeeIdentifierFormatError(
        `"${trimmed}" looks like a wallet address but isn't valid. Check for typos or a truncated address.`
      );
    }
    return { identifier: toChecksumAddress(trimmed), identifierType: "ADDRESS" };
  }

  const normalized = normalizeUsername(trimmed);
  try {
    assertValidUsernameFormat(normalized);
  } catch (err) {
    if (err instanceof InvalidUsernameError) {
      throw new PayeeIdentifierFormatError(`"${raw}" isn't a valid username or wallet address. ${err.message}`);
    }
    throw err;
  }
  return { identifier: normalized, identifierType: "USERNAME" };
}