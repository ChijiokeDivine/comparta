// app/api/invoices/route.ts
//
// Invoice creation computes totals server-side (see lib/invoices/money.ts)
// and never trusts a client-submitted subtotal/total — only line items,
// tax, recipient, and due date are accepted from the request body.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { createInvoice, listInvoices, InvoiceValidationError } from "@/lib/invoices/service";
import { serializeInvoice } from "../../../lib/invoices/serialize";
import type { InvoiceStatus } from "@/app/generated/prisma/client";

const VALID_STATUSES = ["DRAFT", "SENT", "VIEWED", "PAID", "OVERDUE", "VOID"] as const;

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.string().min(1),
  unitPrice: z.string().min(1),
});

const createSchema = z.object({
  recipientIdentifier: z.string().min(1),
  recipientEmail: z.string().email().optional(),
  lineItems: z.array(lineItemSchema).min(1),
  taxAmount: z.string().optional(),
  currency: z.string().optional(),
  dueDate: z.string().min(1),
});

export async function GET(req: Request) {
  try {
    // Read-only — requireAuth is enough (matches lib/contacts). An
    // unapproved org just has an empty list, since it has no way to
    // create invoices yet (see POST below).
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status")?.toUpperCase();
    if (statusParam && !VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: `Invalid status filter "${statusParam}"` }, { status: 400 });
    }

    const invoices = await listInvoices(orgId, {
      status: statusParam as InvoiceStatus | undefined,
    });
    return NextResponse.json({ invoices: invoices.map(serializeInvoice) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const invoice = await createInvoice({ orgId, ...parsed.data });
    return NextResponse.json({ invoice: serializeInvoice(invoice) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof KybNotApprovedError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof InvoiceValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[invoices] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}