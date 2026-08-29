// app/api/org/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { assertCanEditOrgProfile, OrgPermissionError } from "@/lib/auth/canManageOrg";

const updateSchema = z.object({
  legalName: z.string().min(2, "Legal business name is required").max(200).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "Country must be an ISO 3166-1 alpha-2 code")
    .max(2)
    .nullish(),
  preferredCurrencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code")
    .max(3)
    .nullish(),
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
        country: true,
        preferredCurrencyCode: true,
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
      console.warn("[org] validation error", parsed.error.flatten());
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const updateData: {
      legalName?: string;
      country?: string | null;
      preferredCurrencyCode?: string | null;
    } = {};
    if (parsed.data.legalName !== undefined) updateData.legalName = parsed.data.legalName;
    if (parsed.data.country !== undefined) updateData.country = parsed.data.country;
    if (parsed.data.preferredCurrencyCode !== undefined) {
      updateData.preferredCurrencyCode = parsed.data.preferredCurrencyCode;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const org = await prisma.organization.update({
      where: { id: ctx.orgId },
      data: updateData,
      select: {
        id: true,
        legalName: true,
        country: true,
        preferredCurrencyCode: true,
      },
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