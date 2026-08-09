// app/api/pay/[slug]/wallet/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { startWalletCheckout, PaymentLinkNotPayableError, CheckoutValidationError } from "@/lib/paymentLinks/checkout";

const bodySchema = z.object({
  amount: z.string().optional(),
  payerIdentifier: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const session = await startWalletCheckout({
      slug,
      amount: parsed.data.amount,
      payerIdentifier: parsed.data.payerIdentifier,
    });
    return NextResponse.json({ session });
  } catch (err) {
    if (err instanceof PaymentLinkNotPayableError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof CheckoutValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[pay] wallet checkout failed", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}