// lib/insights/counterparty.ts
//
// Resolves an OnchainTransaction's raw counterpartyAddress into a
// display-friendly name — checking the org's Address Book (Contact) and
// Payroll roster (Payee) first, falling back to a heavily truncated
// address if neither has a match. This is THE shared choke point for
// "what do we call this counterparty" across categorization, anomaly
// messages, the top-counterparties dashboard, and NL query results — one
// function, one truncation rule, everywhere a human-readable counterparty
// name is needed.
//
// PRIVACY: truncateAddress() is also what lib/groq/client.ts callers use
// before a counterparty ever appears in an LLM prompt — a full 0x address
// is never sent to Groq, even when no Contact/Payee match exists. This
// isn't a secret (it's a public blockchain address), but the "only send
// what's needed for the task" constraint applies regardless: a display
// name conveys everything the categorization/NL-query task needs, a full
// address conveys nothing extra useful for those tasks.

import { prisma } from "@/lib/db/prisma";

/** "0x1a2b3c4d...9f8e7d6c" — first 8 and last 8 hex chars, never the full address. */
export function truncateAddress(address: string): string {
  if (address.length <= 20) return address; // already short (shouldn't happen for a real Arc address, but never throw over it)
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

/**
 * Best-effort friendly name for `address` within `orgId`'s own Address
 * Book / Payroll roster. Checks Contact first (general address book),
 * then Payee (payroll-specific), then falls back to a truncated address.
 * Never returns the full raw address as the "name" unless the org
 * genuinely has no better information — even then, it's truncated.
 */
export async function resolveCounterpartyDisplayName(
  orgId: string,
  address: string
): Promise<string> {
  const contact = await prisma.contact.findFirst({
    where: { orgId, identifier: address },
    select: { displayName: true },
  });
  if (contact) return contact.displayName;

  const payee = await prisma.payee.findFirst({
    where: { orgId, identifier: address },
    select: { name: true },
  });
  if (payee) return payee.name;

  return truncateAddress(address);
}

/**
 * Batch variant — resolves many addresses in as few queries as possible,
 * for dashboard/list endpoints that would otherwise N+1. Returns a Map
 * keyed by the exact input address string.
 */
export async function resolveCounterpartyDisplayNames(
  orgId: string,
  addresses: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(addresses));
  if (unique.length === 0) return new Map();

  const [contacts, payees] = await Promise.all([
    prisma.contact.findMany({
      where: { orgId, identifier: { in: unique } },
      select: { identifier: true, displayName: true },
    }),
    prisma.payee.findMany({
      where: { orgId, identifier: { in: unique } },
      select: { identifier: true, name: true },
    }),
  ]);

  const result = new Map<string, string>();
  for (const address of unique) {
    result.set(address, truncateAddress(address));
  }
  for (const payee of payees) {
    result.set(payee.identifier, payee.name);
  }
  for (const contact of contacts) {
    // Contact takes priority over Payee if both happen to match the same
    // identifier — the general address book is the more likely place a
    // user maintains an up-to-date display name.
    result.set(contact.identifier, contact.displayName);
  }

  return result;
}