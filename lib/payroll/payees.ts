// lib/payroll/payees.ts
//
// CRUD for Payee — the formal payroll relationship, distinct from
// Contact (the general address book). Mirrors the shape of
// lib/contacts/service.ts. Never touches PayrollRun/PayrollRunItem —
// run generation lives in lib/payroll/runs.ts and reads Payee rows
// read-only.

import { prisma } from "@/lib/db/prisma";
import { toSmallestUnit } from "@/lib/circle/amount";
import { normalizePayeeIdentifier, PayeeIdentifierFormatError } from "./identifier";
import type { Payee, PayType, IdentifierType } from "@/app/generated/prisma/client";

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

export class PayeeInUseError extends Error {
  constructor(runCount: number) {
    super(
      `This payee appears in ${runCount} payroll run(s) and can't be deleted. Deactivate it instead to keep it out of future runs while preserving history.`
    );
    this.name = "PayeeInUseError";
  }
}

function parseDefaultAmount(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  let smallest: bigint;
  try {
    smallest = toSmallestUnit(raw);
  } catch {
    throw new PayeeValidationError(`"${raw}" isn't a valid USDC amount.`);
  }
  if (smallest <= 0n) {
    throw new PayeeValidationError("Default amount must be greater than zero.");
  }
  return smallest;
}

export interface CreatePayeeInput {
  orgId: string;
  name: string;
  identifier: string;
  payType?: PayType; // defaults to CONTRACT
  defaultAmount?: string | null; // decimal string, e.g. "2500.00"
  notes?: string;
  contactId?: string;
}

export async function createPayee(input: CreatePayeeInput): Promise<Payee> {
  const name = input.name.trim();
  if (!name) throw new PayeeValidationError("Payee name is required.");

  const { identifier, identifierType } = normalizePayeeIdentifier(input.identifier);
  const defaultAmount = parseDefaultAmount(input.defaultAmount);

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: input.contactId, orgId: input.orgId } });
    if (!contact) {
      throw new PayeeValidationError("The selected contact does not belong to this organization.");
    }
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
        contactId: input.contactId ?? null,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new PayeeValidationError(`A payee with identifier "${identifier}" already exists for this organization.`);
    }
    throw err;
  }
}

/** Convenience for the "add from address book" UI flow — pre-fills name/identifier from an existing Contact. */
export async function createPayeeFromContact(
  orgId: string,
  contactId: string,
  extra: Omit<CreatePayeeInput, "orgId" | "name" | "identifier" | "contactId">
): Promise<Payee> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId } });
  if (!contact) throw new PayeeValidationError("Contact not found.");

  return createPayee({
    orgId,
    name: contact.displayName,
    identifier: contact.identifier,
    contactId: contact.id,
    ...extra,
  });
}

export async function listPayees(orgId: string, options: { active?: boolean } = {}): Promise<Payee[]> {
  return prisma.payee.findMany({
    where: { orgId, ...(options.active !== undefined ? { active: options.active } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getPayee(orgId: string, payeeId: string): Promise<Payee> {
  const payee = await prisma.payee.findFirst({ where: { id: payeeId, orgId } });
  if (!payee) throw new PayeeNotFoundError();
  return payee;
}

export interface UpdatePayeeInput {
  name?: string;
  identifier?: string;
  payType?: PayType;
  defaultAmount?: string | null; // pass null explicitly to clear
  notes?: string | null;
  active?: boolean;
  contactId?: string | null;
}

export async function updatePayee(orgId: string, payeeId: string, input: UpdatePayeeInput): Promise<Payee> {
  await getPayee(orgId, payeeId); // ownership check

  const data: {
    name?: string;
    identifier?: string;
    identifierType?: IdentifierType;
    payType?: PayType;
    defaultAmount?: bigint | null;
    notes?: string | null;
    active?: boolean;
    contactId?: string | null;
  } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new PayeeValidationError("Payee name is required.");
    data.name = name;
  }
  if (input.identifier !== undefined) {
    const { identifier, identifierType } = normalizePayeeIdentifier(input.identifier);
    data.identifier = identifier;
    data.identifierType = identifierType;
  }
  if (input.payType !== undefined) data.payType = input.payType;
  if (input.defaultAmount !== undefined) data.defaultAmount = parseDefaultAmount(input.defaultAmount);
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.active !== undefined) data.active = input.active;
  if (input.contactId !== undefined) {
    if (input.contactId) {
      const contact = await prisma.contact.findFirst({ where: { id: input.contactId, orgId } });
      if (!contact) throw new PayeeValidationError("The selected contact does not belong to this organization.");
    }
    data.contactId = input.contactId;
  }

  try {
    return await prisma.payee.update({ where: { id: payeeId }, data });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new PayeeValidationError(`A payee with identifier "${data.identifier}" already exists for this organization.`);
    }
    throw err;
  }
}

/** Convenience wrapper — the common case of removing a payee from future runs without losing their history. */
export async function deactivatePayee(orgId: string, payeeId: string): Promise<Payee> {
  return updatePayee(orgId, payeeId, { active: false });
}

/**
 * Hard-deletes a payee that has never appeared in a payroll run. A payee
 * with run history is kept for audit purposes (PayrollRunItem.payeeId is
 * onDelete: Restrict, so this would fail at the DB level anyway) —
 * deactivate instead.
 */
export async function deletePayee(orgId: string, payeeId: string): Promise<void> {
  await getPayee(orgId, payeeId); // ownership check

  const runItemCount = await prisma.payrollRunItem.count({ where: { payeeId } });
  if (runItemCount > 0) {
    const runCount = await prisma.payrollRunItem
      .findMany({ where: { payeeId }, select: { payrollRunId: true }, distinct: ["payrollRunId"] })
      .then((rows) => rows.length);
    throw new PayeeInUseError(runCount);
  }

  await prisma.payee.delete({ where: { id: payeeId } });
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}