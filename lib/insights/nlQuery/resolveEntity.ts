// lib/insights/nlQuery/resolveEntity.ts
//
// Turns whatever the user typed for a counterparty or category — a raw
// 0x address, an "@username", or a free-text name like "Acme Freight" —
// into something queries.ts can filter on. This is where "ask about
// wallet addresses, usernames etc." is actually handled: the translator
// (translate.ts) doesn't try to resolve identity, it just extracts the
// raw string; resolution happens here, against real org data, so it's
// never guessed by the LLM.

import { prisma } from "@/lib/db/prisma";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface ResolvedCounterparty {
  address: string;
  /** Best display name we could find — contact name, org username, or a shortened address. */
  label: string;
}

function shortenAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Resolves a raw counterparty string to a wallet address to filter
 * OnchainTransaction.counterpartyAddress on. Returns null if nothing
 * matched — callers should surface a "couldn't find X" answer rather
 * than silently returning unfiltered results.
 */
export async function resolveCounterparty(orgId: string, raw: string): Promise<ResolvedCounterparty | null> {
  const query = raw.trim();
  if (!query) return null;

  // 1. Already a wallet address — use directly, but still try to find a
  //    friendlier label via a saved Contact.
  if (ADDRESS_RE.test(query)) {
    const contact = await prisma.contact.findFirst({
      where: { orgId, identifierType: "ADDRESS", identifier: { equals: query, mode: "insensitive" } },
    });
    return { address: query, label: contact?.displayName ?? shortenAddress(query) };
  }

  const handle = query.replace(/^@/, "");

  // 2. Saved Contact — by username-style identifier first, then by
  //    display name (handles "Acme Freight" style questions).
  const byIdentifier = await prisma.contact.findFirst({
    where: { orgId, identifierType: "USERNAME", identifier: { equals: handle, mode: "insensitive" } },
  });
  if (byIdentifier && ADDRESS_RE.test(byIdentifier.identifier)) {
    return { address: byIdentifier.identifier, label: byIdentifier.displayName };
  }

  const byName = await prisma.contact.findFirst({
    where: { orgId, displayName: { equals: handle, mode: "insensitive" } },
  });
  if (byName) {
    // A Contact's `identifier` is the address ONLY when identifierType
    // is ADDRESS; a USERNAME-typed contact still needs its wallet
    // resolved via the platform username lookup below.
    if (byName.identifierType === "ADDRESS") {
      return { address: byName.identifier, label: byName.displayName };
    }
    const org = await resolvePlatformUsername(byName.identifier);
    if (org) return { address: org.address, label: byName.displayName };
  }

  // Loosen to a "contains" match if no exact contact name matched.
  const byNameContains = await prisma.contact.findFirst({
    where: { orgId, displayName: { contains: handle, mode: "insensitive" } },
  });
  if (byNameContains?.identifierType === "ADDRESS") {
    return { address: byNameContains.identifier, label: byNameContains.displayName };
  }

  // 3. A platform username (another org on this network), independent
  //    of whether it's saved as a Contact.
  const org = await resolvePlatformUsername(handle);
  if (org) return org;

  return null;
}

async function resolvePlatformUsername(username: string): Promise<ResolvedCounterparty | null> {
  const org = await prisma.organization.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    include: { wallets: { take: 1 } },
  });
  const wallet = org?.wallets[0];
  if (!org || !wallet) return null;
  return { address: wallet.arcAddress, label: org.legalName || `@${org.username}` };
}

/** Resolves a raw category name (case-insensitive) to a TransactionCategory id, ignoring archived categories. */
export async function resolveCategory(orgId: string, raw: string): Promise<{ id: string; name: string } | null> {
  const query = raw.trim();
  if (!query) return null;

  const exact = await prisma.transactionCategory.findFirst({
    where: { orgId, archived: false, name: { equals: query, mode: "insensitive" } },
  });
  if (exact) return { id: exact.id, name: exact.name };

  const loose = await prisma.transactionCategory.findFirst({
    where: { orgId, archived: false, name: { contains: query, mode: "insensitive" } },
  });
  return loose ? { id: loose.id, name: loose.name } : null;
}