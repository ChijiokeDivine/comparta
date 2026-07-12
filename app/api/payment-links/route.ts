// app/api/payment-links/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { createPaymentLink, listPaymentLinks, PaymentLinkValidationError } from "@/lib/paymentLinks/service";
import { serializePaymentLink } from "@/lib/paymentLinks/serialize";

const VALID_STATUSES = ["ACTIVE", "PAUSED", "EXPIRED"] as const;

const createSchema = z
  .object({
    type: z.enum(["FIXED_AMOUNT", "OPEN_AMOUNT"]),
    amount: z.string().optional(),
    description: z.string().max(500).optional(),
    expiresAt: z.string().optional(),
    maxUses: z.number().int().positive().optional(),
    receivingLedgerAccountId: z.string().min(1),
  })
  .strict();

export async function GET(req: Request) {
  try {
    // Read-only — requireAuth is enough (matches lib/invoices' GET).
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status")?.toUpperCase();
    if (statusParam && !VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: `Invalid status filter "${statusParam}"` }, { status: 400 });
    }

    const links = await listPaymentLinks(orgId, {
      status: statusParam as (typeof VALID_STATUSES)[number] | undefined,
    });

    return NextResponse.json({
      paymentLinks: links.map((link) => ({
        ...serializePaymentLink(link),
        confirmedPaymentCount: link._count.payments,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const link = await createPaymentLink({ orgId, ...parsed.data });
    return NextResponse.json(
      { paymentLink: { ...serializePaymentLink(link), url: `/pay/${link.slug}` } },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof KybNotApprovedError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof PaymentLinkValidationError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error("[payment-links] request failed", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}