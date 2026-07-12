// app/api/payment-links/[id]/route.ts

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { getPaymentLinkWithUsage, PaymentLinkNotFoundError } from "@/lib/paymentLinks/service";
import { serializePaymentLink } from "@/lib/paymentLinks/serialize";
import { toDecimalString } from "@/lib/circle/amount";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;

    const { link, confirmedPaymentCount, totalCollected, payments } = await getPaymentLinkWithUsage(orgId, id);

    return NextResponse.json({
      paymentLink: {
        ...serializePaymentLink(link),
        url: `/pay/${link.slug}`,
        confirmedPaymentCount,
        totalCollected: toDecimalString(totalCollected),
      },
      payments: payments.map((p) => ({
        ...p,
        amountPaid: p.amountPaid !== null ? toDecimalString(p.amountPaid) : null,
      })),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof PaymentLinkNotFoundError) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }
    console.error("[payment-links/:id] failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}