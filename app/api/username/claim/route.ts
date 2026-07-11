// app/api/username/claim/route.ts
//
// Claims a $cashtag-style username for the authenticated org. Pipeline:
// auth -> KYB gate -> rate limit -> format validation -> denylist ->
// database uniqueness (race-safe via the unique constraint on
// Organization.username, not just a pre-check SELECT).

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireApprovedOrg, UnauthenticatedError, KybNotApprovedError } from "@/lib/auth/kyb-gate";
import { validateUsernameForClaim, InvalidUsernameError } from "@/lib/identity/username";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/http/clientIp";

const claimSchema = z.object({
  username: z.string().min(1),
});

// Generous enough for a real person retrying a typo'd handle a few times,
// tight enough to make scripted squatting across many candidate names slow.
const CLAIM_RATE_LIMIT = 10;
const CLAIM_RATE_WINDOW_SECONDS = 60 * 10; // 10 minutes

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();

    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit(`username-claim:${ip}`, CLAIM_RATE_LIMIT, CLAIM_RATE_WINDOW_SECONDS);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many username claim attempts. Try again in ${Math.ceil(rateLimit.resetSeconds / 60)} minute(s).`,
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = claimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    let normalized: string;
    try {
      normalized = validateUsernameForClaim(parsed.data.username);
    } catch (err) {
      if (err instanceof InvalidUsernameError) {
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      throw err;
    }

    // Race-safety: two concurrent claims for the same name both pass the
    // checks above and both attempt this write; the unique constraint on
    // `username` is the actual source of truth, and we translate its
    // violation (P2002) into a clean 409 rather than a 500.
    try {
      const org = await prisma.organization.update({
        where: { id: orgId },
        data: { username: normalized },
        select: { id: true, username: true },
      });

      return NextResponse.json({ organization: org });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return NextResponse.json(
          { error: `Username "@${normalized}" is already taken.` },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof KybNotApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[username/claim] failed", err);
    return NextResponse.json({ error: "Failed to claim username" }, { status: 500 });
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}