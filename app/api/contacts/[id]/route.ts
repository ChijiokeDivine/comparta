// app/api/contacts/[id]/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import {
  getContact,
  updateContact,
  deleteContact,
  ContactValidationError,
  ContactNotFoundError,
} from "@/lib/contacts/service";

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const contact = await getContact(orgId, id);
    return NextResponse.json({ contact });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const contact = await updateContact(orgId, id, parsed.data);
    return NextResponse.json({ contact });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    await deleteContact(orgId, id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof ContactNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ContactValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[contacts/:id] failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}