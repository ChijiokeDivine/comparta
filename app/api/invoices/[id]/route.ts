// app/api/invoices/[id]/route.ts

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { getInvoice, InvoiceNotFoundError } from "@/lib/invoices/service";
import { serializeInvoiceWithEvents } from "@/lib/invoices/serialize"

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const invoice = await getInvoice(orgId, id);
    return NextResponse.json({ invoice: serializeInvoiceWithEvents(invoice) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    console.error("[invoices/:id] failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}