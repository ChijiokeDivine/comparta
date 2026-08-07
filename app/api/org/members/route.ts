// app/api/org/members/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";

export async function GET() {
  try {
    const { orgId } = await requireAuth();
    const members = await prisma.user.findMany({
      where: { orgId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ members });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[org/members] list failed", err);
    return NextResponse.json({ error: "Failed to list team members" }, { status: 500 });
  }
}