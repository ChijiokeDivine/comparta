// app/api/pay/[slug]/card/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { startCardCheckout, PaymentLinkNotPayableError, CheckoutValidationError } from "@/lib/paymentLinks/checkout";
import { CirclePaymentsApiError } from "@/lib/circle/payments";

const bodySchema = z.object({
  amount: z.string().optional(),
  payerEmail: z.string().email().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const session = await startCardCheckout({
      slug,
      amount: parsed.data.amount,
      payerEmail: parsed.data.payerEmail,
    });
    return NextResponse.json({ session });
  } catch (err) {
    if (err instanceof PaymentLinkNotPayableError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof CheckoutValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof CirclePaymentsApiError) {
      return NextResponse.json(
        { error: "Card/bank checkout isn't available right now. Try paying from a wallet instead." },
        { status: 502 }
      );
    }
    console.error("[pay] card checkout failed", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}