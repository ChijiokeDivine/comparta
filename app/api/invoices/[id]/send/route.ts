// app/api/invoices/[id]/send/route.ts

import { NextResponse } from "next/server";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { sendInvoice, InvoiceNotFoundError, InvoiceStateError } from "@/lib/invoices/service";
import { serializeInvoice} from "@/lib/invoices/serialize"

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireApprovedOrg();
    const { id } = await params;

    // Prefer an explicit origin (works behind proxies where req.url's
    // host may not be the public one); fall back to req.url's origin.
    const publicBaseUrl =
      req.headers.get("x-forwarded-host") && req.headers.get("x-forwarded-proto")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : new URL(req.url).origin;

    const invoice = await sendInvoice(orgId, id, publicBaseUrl);
    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (err instanceof InvoiceStateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[invoices/:id/send] failed", err);
    return NextResponse.json({ error: "Failed to send invoice" }, { status: 500 });
  }
}