// app/api/org/webhook-events/route.ts
//
// OWNER-only diagnostic view. WebhookEvent isn't scoped to an org in the
// schema (Circle delivers a webhook before we necessarily know which org
// owns the affected wallet — see lib/transfers/receive.ts), so this
// intentionally shows recent events across the whole deployment, not
// just the caller's org. That's fine for a single/few-tenant hackathon
// deployment; a real multi-tenant version of this page would need to
// filter by resolving each event's wallet -> org first.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { assertIsOwner, OwnerOnlyError } from "@/lib/auth/canManageOrg";

export async function GET() {
  try {
    const ctx = await requireAuth();
    assertIsOwner(ctx);

    const events = await prisma.webhookEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        source: true,
        eventType: true,
        signatureOk: true,
        status: true,
        processError: true,
        createdAt: true,
        processedAt: true,
      },
    });

    return NextResponse.json({ events });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof OwnerOnlyError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[org/webhook-events] list failed", err);
    return NextResponse.json({ error: "Failed to load webhook events" }, { status: 500 });
  }
}