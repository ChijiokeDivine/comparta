// app/api/invoices/public/[invoiceId]/route.ts
//
// Deliberately unauthenticated — this is what the public payer-facing
// page at app/invoices/pay/[invoiceId]/page.tsx polls to notice a PAID
// transition (written by the existing background reconciliation in
// lib/invoices/reconciliation.ts, triggered off inbound-transfer
// confirmations) without a manual refresh. Never touch requireAuth()
// here; getPublicInvoice() itself already refuses to leak DRAFT
// invoices, which is the only sensitive state this could expose.

import { NextResponse } from "next/server";
import { getPublicInvoice, recordInvoiceViewed, InvoiceNotFoundError } from "@/lib/invoices/service";

export async function GET(req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    const { invoiceId } = await params;
    const invoice = await getPublicInvoice(invoiceId);
    // Best-effort — a failure here shouldn't stop the payer from seeing
    // the invoice. Also fine to call on every poll: recordInvoiceViewed
    // dedupes within its own 30-minute window (see lib/invoices/service.ts),
    // so a repeat visitor's page polling every 8s doesn't spam VIEWED events.
    recordInvoiceViewed(invoiceId).catch((err) =>
      console.error(`[invoices/public] recordInvoiceViewed failed for ${invoiceId}`, err)
    );
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    console.error("[invoices/public] failed", err);
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}