// lib/payroll/payees.ts
//
// Payee business logic: create/list/get/update/delete. Payee is the
// payroll-specific roster row - distinct from the general Contact
// address book (see model-level docs in prisma/schema.prisma). Identifier
// normalization is delegated to lib/payroll/identifier.ts, which mirrors
// the same USERNAME vs ADDRESS inference rules lib/contacts/service.ts
// uses; this way Contact → Payee conversion never produces a Payee whose
// identifier resolves differently than the Contact it came from.
//
// Both the /api/payroll/payees and /api/payroll/payees/[id] routes import
// from here. Error types carry the specific HTTP status each route maps
// them to (see handleError in each route file).

import { prisma } from "@/lib/db/prisma";
import type { Payee, PayType } from "@/app/generated/prisma/client";
import { toSmallestUnit } from "@/lib/circle/amount";
import {
  normalizePayeeIdentifier,
  PayeeIdentifierFormatError,
} from "./identifier";

// ── Error types ────────────────────────────────────────────────────────

export { PayeeIdentifierFormatError };

export class PayeeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayeeValidationError";
  }
}

export class PayeeNotFoundError extends Error {
  constructor() {
    super("Payee not found");
    this.name = "PayeeNotFoundError";
  }
}

/**
 * Thrown by deletePayee when the payee has already been referenced in one
 * or more payroll runs. The HTTP layer maps this to status 409 — the UI
 * then tells the user the payee was "deactivated instead of deleted".
 */
export class PayeeInUseError extends Error {
  constructor(usedInRunCount: number) {
    super(
      `This payee has been used in ${usedInRunCount} payroll run${usedInRunCount === 1 ? "" : "s"} and can't be deleted. ` +
        `They have been marked inactive instead.`
    );
    this.name = "PayeeInUseError";
  }
}

// ── Input types ────────────────────────────────────────────────────────

export interface CreatePayeeInput {
  orgId: string;
  name: string;
  identifier: string;
  payType?: PayType;
  defaultAmount?: string | null;
  notes?: string;
  contactId?: string;
}

export interface ListPayeesFilter {
  active?: boolean;
}

export interface UpdatePayeeInput {
  name?: string;
  identifier?: string;
  payType?: PayType;
  defaultAmount?: string | null;
  notes?: string | null;
  active?: boolean;
  contactId?: string | null;
}

// ── Validators / shared helpers ────────────────────────────────────────

function parseDefaultAmount(raw: string | null | undefined): bigint | null | undefined {
  if (raw === undefined) return undefined; // passthrough — caller didn't set
  if (raw === null) return null; // explicit clear
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const smallest = toSmallestUnit(trimmed);
    if (smallest < 1n) throw new PayeeValidationError("Default amount must be greater than zero.");
    return smallest;
  } catch (err) {
    if (err instanceof PayeeValidationError) throw err;
    throw new PayeeValidationError(`"${raw}" isn't a valid USDC amount.`);
  }
}

async function assertContactBelongsToOrg(
  orgId: string,
  contactId: string | null | undefined
): Promise<void> {
  if (contactId === undefined || contactId === null) return;
  const row = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: { id: true },
  });
  if (!row) {
    throw new PayeeValidationError(
      "The selected contact doesn't belong to your organization."
    );
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

// ── CRUD ───────────────────────────────────────────────────────────────

export async function createPayee(input: CreatePayeeInput): Promise<Payee> {
  const { identifier, identifierType } = normalizePayeeIdentifier(input.identifier);
  const defaultAmount = parseDefaultAmount(input.defaultAmount);
  await assertContactBelongsToOrg(input.orgId, input.contactId);

  const name = input.name.trim();
  if (!name) throw new PayeeValidationError("Name can't be blank.");
  if (input.notes !== undefined && input.notes.length > 2000) {
    throw new PayeeValidationError("Notes are too long (max 2000 characters).");
  }

  try {
    return await prisma.payee.create({
      data: {
        orgId: input.orgId,
        name,
        identifier,
        identifierType,
        payType: input.payType ?? "CONTRACT",
        defaultAmount,
        notes: input.notes?.trim() || null,
        contactId: input.contactId || undefined,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new PayeeValidationError(
        `A payee with identifier "${identifier}" already exists in this organization.`
      );
    }
    throw err;
  }
}

export async function listPayees(
  orgId: string,
  filter: ListPayeesFilter = {}
): Promise<Payee[]> {
  return prisma.payee.findMany({
    where: {
      orgId,
      ...(filter.active !== undefined ? { active: filter.active } : {}),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getPayee(orgId: string, id: string): Promise<Payee> {
  const payee = await prisma.payee.findFirst({ where: { id, orgId } });
  if (!payee) throw new PayeeNotFoundError();
  return payee;
}

export async function updatePayee(
  orgId: string,
  id: string,
  patch: UpdatePayeeInput
): Promise<Payee> {
  const existing = await getPayee(orgId, id);

  let identifier: string | undefined;
  let identifierType: typeof existing.identifierType | undefined;

  if (patch.identifier !== undefined && patch.identifier.trim() !== existing.identifier) {
    const norm = normalizePayeeIdentifier(patch.identifier);
    identifier = norm.identifier;
    identifierType = norm.identifierType;
  }

  let defaultAmount: bigint | null | undefined;
  if ("defaultAmount" in patch) {
    defaultAmount = parseDefaultAmount(patch.defaultAmount);
  }

  if ("contactId" in patch) {
    await assertContactBelongsToOrg(orgId, patch.contactId);
  }

  if (patch.notes !== undefined && patch.notes !== null && patch.notes.length > 2000) {
    throw new PayeeValidationError("Notes are too long (max 2000 characters).");
  }

  let name: string | undefined;
  if (patch.name !== undefined) {
    name = patch.name.trim();
    if (!name) throw new PayeeValidationError("Name can't be blank.");
  }

  const data: Parameters<typeof prisma.payee.update>[0]["data"] = {};
  if (name !== undefined) data.name = name;
  if (identifier !== undefined) data.identifier = identifier;
  if (identifierType !== undefined) data.identifierType = identifierType;
  if (patch.payType !== undefined) data.payType = patch.payType;
  if (defaultAmount !== undefined) data.defaultAmount = defaultAmount;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  if (patch.active !== undefined) data.active = patch.active;
  if ("contactId" in patch) data.contactId = patch.contactId || null;

  try {
    return await prisma.payee.update({ where: { id: existing.id }, data });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new PayeeValidationError(
        `A payee with identifier "${identifier ?? patch.identifier}" already exists in this organization.`
      );
    }
    throw err;
  }
}

/**
 * Hard-deletes a payee that has never been included in any payroll run.
 * If it has, flips active=false instead and throws PayeeInUseError so
 * the HTTP layer can surface a 409 with the "deactivated instead of
 * deleted" message the edit page knows how to display.
 */
export async function deletePayee(orgId: string, id: string): Promise<void> {
  const existing = await getPayee(orgId, id);

  const usedCount = await prisma.payrollRunItem.count({
    where: { payeeId: id },
  });

  if (usedCount > 0) {
    await prisma.payee.update({
      where: { id: existing.id },
      data: { active: false },
    });
    throw new PayeeInUseError(usedCount);
  }

  await prisma.payee.delete({ where: { id: existing.id } });
}
