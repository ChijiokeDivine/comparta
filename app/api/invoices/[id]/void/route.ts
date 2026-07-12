// app/api/invoices/[id]/void/route.ts

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { voidInvoice, InvoiceNotFoundError, InvoiceStateError } from "@/lib/invoices/service";
import { serializeInvoice } from "../../../../../lib/invoices/serialize";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const invoice = await voidInvoice(orgId, id);
    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (err instanceof InvoiceStateError) {
      // Contradictory state (voiding a paid invoice) — 409 Conflict, not a validation error.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[invoices/:id/void] failed", err);
    return NextResponse.json({ error: "Failed to void invoice" }, { status: 500 });
  }
}