// app/api/org/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { assertCanEditOrgProfile, OrgPermissionError } from "@/lib/auth/canManageOrg";

const updateSchema = z.object({
  legalName: z.string().min(2, "Legal business name is required").max(200),
});

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        legalName: true,
        username: true,
        kybStatus: true,
        kybApprovedAt: true,
        createdAt: true,
      },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    return NextResponse.json({ organization: org });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[org] get failed", err);
    return NextResponse.json({ error: "Failed to load organization" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await requireAuth();
    assertCanEditOrgProfile(ctx);

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const org = await prisma.organization.update({
      where: { id: ctx.orgId },
      data: { legalName: parsed.data.legalName },
      select: { id: true, legalName: true },
    });

    return NextResponse.json({ organization: org });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof OrgPermissionError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[org] update failed", err);
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 });
  }
}