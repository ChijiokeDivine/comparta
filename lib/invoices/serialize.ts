// lib/invoices/serialize.ts
//
// Prisma's Invoice model stores subtotal/taxAmount/total as BigInt, which
// JSON.stringify (and therefore NextResponse.json) cannot serialize
// as-is. Every API route returning an Invoice must go through here first
// — same convention as toDecimalString use in app/api/wallet/balance/route.ts.

import { toDecimalString } from "@/lib/circle/amount";
import type { Invoice, InvoiceEvent } from "@/app/generated/prisma/client";

export function serializeInvoice(invoice: Invoice) {
  return {
    ...invoice,
    subtotal: toDecimalString(invoice.subtotal),
    taxAmount: toDecimalString(invoice.taxAmount),
    total: toDecimalString(invoice.total),
  };
}

export function serializeInvoiceWithEvents(invoice: Invoice & { events: InvoiceEvent[] }) {
  return serializeInvoice(invoice);
}