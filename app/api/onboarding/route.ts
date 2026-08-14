// app/api/onboarding/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

const bodySchema = z.object({
  legalName: z.string().trim().min(1, "Please enter your organization or business name."),
  ownerName: z.string().trim().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.orgId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { legalName, ownerName } = parsed.data;

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: session.user.orgId },
      data: { legalName },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        onboardingCompleted: true,
        ...(ownerName ? { name: ownerName } : {}),
      },
    }),
  ]);

  return NextResponse.json({ message: "Onboarding complete" });
}