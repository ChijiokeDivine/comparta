// lib/contacts/service.ts
//
// Address book business logic. Identifier type (USERNAME vs ADDRESS) is
// always inferred from the identifier's format rather than trusted from
// caller input — same format rules as lib/identity/resolver.ts, so a
// saved contact's type can never drift from what resolve() would
// actually do with it.

import { prisma } from "@/lib/db/prisma";
import type { Contact, IdentifierType } from "@/app/generated/prisma/client";
import { normalizeUsername, assertValidUsernameFormat, InvalidUsernameError } from "@/lib/identity/username";
import { isValidAddress, toChecksumAddress } from "@/lib/identity/address";

export class ContactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactValidationError";
  }
}

export class ContactNotFoundError extends Error {
  constructor() {
    super("Contact not found");
    this.name = "ContactNotFoundError";
  }
}

/**
 * Normalizes a raw identifier into its canonical stored form and infers
 * its type. Throws ContactValidationError with a specific reason if the
 * identifier is shaped like neither a username nor an address.
 */
function normalizeIdentifier(raw: string): { identifier: string; identifierType: IdentifierType } {
  const trimmed = raw.trim();

  if (trimmed.toLowerCase().startsWith("0x")) {
    if (!isValidAddress(trimmed)) {
      throw new ContactValidationError(
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
      throw new ContactValidationError(
        `"${raw}" isn't a valid username or wallet address. ${err.message}`
      );
    }
    throw err;
  }
  return { identifier: normalized, identifierType: "USERNAME" };
}

export interface CreateContactInput {
  orgId: string;
  displayName: string;
  identifier: string;
  notes?: string;
}

export async function createContact(input: CreateContactInput): Promise<Contact> {
  const { identifier, identifierType } = normalizeIdentifier(input.identifier);

  try {
    return await prisma.contact.create({
      data: {
        orgId: input.orgId,
        displayName: input.displayName.trim(),
        identifier,
        identifierType,
        notes: input.notes?.trim() || null,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new ContactValidationError(
        `A contact with identifier "${identifier}" already exists in your address book.`
      );
    }
    throw err;
  }
}

export async function listContacts(orgId: string): Promise<Contact[]> {
  return prisma.contact.findMany({
    where: { orgId },
    orderBy: [{ lastPaidAt: "desc" }, { displayName: "asc" }],
  });
}

export async function getContact(orgId: string, contactId: string): Promise<Contact> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId } });
  if (!contact) throw new ContactNotFoundError();
  return contact;
}

export interface UpdateContactInput {
  displayName?: string;
  identifier?: string;
  notes?: string | null;
}

export async function updateContact(
  orgId: string,
  contactId: string,
  input: UpdateContactInput
): Promise<Contact> {
  // Ownership check first — findFirst scoped to orgId — so an org can
  // never update another org's contact by guessing an id.
  await getContact(orgId, contactId);

  const data: {
    displayName?: string;
    identifier?: string;
    identifierType?: IdentifierType;
    notes?: string | null;
  } = {};

  if (input.displayName !== undefined) data.displayName = input.displayName.trim();
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.identifier !== undefined) {
    const { identifier, identifierType } = normalizeIdentifier(input.identifier);
    data.identifier = identifier;
    data.identifierType = identifierType;
  }

  try {
    return await prisma.contact.update({ where: { id: contactId }, data });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new ContactValidationError(
        `A contact with identifier "${data.identifier}" already exists in your address book.`
      );
    }
    throw err;
  }
}

export async function deleteContact(orgId: string, contactId: string): Promise<void> {
  await getContact(orgId, contactId); // ownership check
  await prisma.contact.delete({ where: { id: contactId } });
}

/** Called after a successful transfer to denormalize lastPaidAt for sort ordering. */
export async function touchContactLastPaid(orgId: string, identifier: string): Promise<void> {
  await prisma.contact.updateMany({
    where: { orgId, identifier },
    data: { lastPaidAt: new Date() },
  });
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}