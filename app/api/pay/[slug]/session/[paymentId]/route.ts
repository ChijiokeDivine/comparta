// app/api/pay/[slug]/session/[paymentId]/route.ts
//
// Scoped by slug as well as paymentId even though paymentId (a cuid) is
// already unpractical to guess — cheap defense in depth, and it means a
// stale/mismatched session id from a different link's checkout can never
// leak another merchant's payment status here.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; paymentId: string }> }
) {
  try {
    const { slug, paymentId } = await params;

    const payment = await prisma.paymentLinkPayment.findFirst({
      where: { id: paymentId, paymentLink: { slug } },
      select: {
        id: true,
        method: true,
        status: true,
        amountExpected: true,
        amountPaid: true,
        failureReason: true,
      },
    });

    if (!payment) {
      return NextResponse.json({ error: "Checkout session not found" }, { status: 404 });
    }

    return NextResponse.json({
      session: {
        ...payment,
        amountExpected: toDecimalString(payment.amountExpected),
        amountPaid: payment.amountPaid !== null ? toDecimalString(payment.amountPaid) : null,
      },
    });
  } catch (err) {
    console.error("[pay] session status check failed", err);
    return NextResponse.json({ error: "Failed to check checkout status" }, { status: 500 });
  }
}