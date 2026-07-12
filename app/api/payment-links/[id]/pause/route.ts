import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { pausePaymentLink, PaymentLinkNotFoundError, PaymentLinkStateError } from "@/lib/paymentLinks/service";
import { serializePaymentLink } from "@/lib/paymentLinks/serialize";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteParams) {
  try {
    const { orgId } = await requireAuth();
    const { id } = await params;
    const link = await pausePaymentLink(orgId, id);
    return NextResponse.json({ paymentLink: serializePaymentLink(link) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof PaymentLinkNotFoundError) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }
    if (err instanceof PaymentLinkStateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[payment-links/:id/pause] failed", err);
    return NextResponse.json({ error: "Failed to pause payment link" }, { status: 500 });
  }
}



