// app/api/org/members/[id]/route.ts
//
// OWNER-only team management. Both actions carry the same two lockout
// guards, since either one can strand an org with no one able to manage
// it:
//   - can't act on your own membership (no self-demote, no self-remove
//     — an OWNER who wants to leave should have another OWNER do it, or
//     promote someone else first)
//   - can't remove/demote the org's last remaining OWNER

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { assertIsOwner, OwnerOnlyError } from "@/lib/auth/canManageOrg";

const updateRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

class LastOwnerError extends Error {
  constructor() {
    super("This organization must have at least one OWNER.");
    this.name = "LastOwnerError";
  }
}

class SelfActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfActionError";
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireAuth();
    assertIsOwner(ctx);

    if (id === ctx.userId) {
      throw new SelfActionError("You can't change your own role. Have another OWNER do it.");
    }

    const body = await req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const target = await prisma.user.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!target) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    if (target.role === "OWNER" && parsed.data.role !== "OWNER") {
      await assertNotLastOwner(ctx.orgId, id);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, name: true, email: true, role: true },
    });

    return NextResponse.json({ member: updated });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof OwnerOnlyError || err instanceof SelfActionError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof LastOwnerError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[org/members] role update failed", err);
    return NextResponse.json({ error: "Failed to update team member" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireAuth();
    assertIsOwner(ctx);

    if (id === ctx.userId) {
      throw new SelfActionError("You can't remove yourself. Have another OWNER do it.");
    }

    const target = await prisma.user.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!target) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    if (target.role === "OWNER") {
      await assertNotLastOwner(ctx.orgId, id);
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof OwnerOnlyError || err instanceof SelfActionError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof LastOwnerError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[org/members] remove failed", err);
    return NextResponse.json({ error: "Failed to remove team member" }, { status: 500 });
  }
}

async function assertNotLastOwner(orgId: string, excludingUserId: string): Promise<void> {
  const otherOwnerCount = await prisma.user.count({
    where: { orgId, role: "OWNER", id: { not: excludingUserId } },
  });
  if (otherOwnerCount === 0) {
    throw new LastOwnerError();
  }
}