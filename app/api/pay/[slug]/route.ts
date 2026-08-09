// app/api/pay/[slug]/route.ts
//
// Deliberately unauthenticated — mirrors app/api/invoices/public/[invoiceId].
// getPublicPaymentLink never throws for an ordinary unpayable state
// (paused/expired/used-up/not-found); those come back as a normal 200
// with payable:false + unavailableReason, which is what the checkout
// page renders a friendly message for.

import { NextResponse } from "next/server";
import { getPublicPaymentLink } from "@/lib/paymentLinks/checkout";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const link = await getPublicPaymentLink(slug);
    return NextResponse.json({ paymentLink: link });
  } catch (err) {
    console.error("[pay] load link failed", err);
    return NextResponse.json({ error: "Failed to load payment link" }, { status: 500 });
  }
}