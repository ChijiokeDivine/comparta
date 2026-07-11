// app/api/resolve/[identifier]/route.ts
//
// Public resolution endpoint: given a username OR a raw Arc address,
// returns the destination address plus org display name when known. This
// is a thin HTTP wrapper over lib/identity/resolver.ts — every internal
// caller (send, invoices, payment links) should import resolve() directly
// rather than hitting this route over HTTP; this route exists for
// clients (frontend, other services) that need resolution without direct
// database access.
//
// Requires authentication (any signed-in org can resolve any other org's
// public username/address — usernames are public by design, like a
// $cashtag), but does NOT require KYB approval: looking someone up isn't
// a financial action.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { resolve, ResolverError } from "@/lib/identity/resolver";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ identifier: string }> }
) {
  try {
    await requireAuth();

    const { identifier } = await params;
    const decoded = decodeURIComponent(identifier ?? "");

    const result = await resolve(decoded);

    return NextResponse.json({
      type: result.type,
      address: result.address,
      orgId: result.orgId ?? null,
      displayName: result.displayName ?? null,
      username: result.username ?? null,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ResolverError) {
      const status = err.code === "MALFORMED_IDENTIFIER" ? 400 : 404;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[resolve] failed", err);
    return NextResponse.json({ error: "Failed to resolve identifier" }, { status: 500 });
  }
}