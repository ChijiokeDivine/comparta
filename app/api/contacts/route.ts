// app/api/contacts/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { createContact, listContacts, ContactValidationError } from "@/app/api/contacts/service";

const createSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  identifier: z.string().min(1, "Identifier is required"),
  notes: z.string().optional(),
});

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const contacts = await listContacts(orgId);
    return NextResponse.json({ contacts });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[contacts] list failed", err);
    return NextResponse.json({ error: "Failed to list contacts" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const contact = await createContact({ orgId, ...parsed.data });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ContactValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[contacts] create failed", err);
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }
}