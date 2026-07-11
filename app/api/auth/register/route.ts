// app/api/auth/register/route.ts
//
// Signs up a new business: creates the Organization (kybStatus: PENDING)
// and its first User (role: OWNER). No wallet is provisioned yet — that
// happens once KYB is approved (see /api/org/kyb/approve), per the
// middleware.ts / kyb-gate.ts rule that no financial feature is reachable
// pre-approval.

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

const registerSchema = z.object({
  legalName: z.string().min(2, "Legal business name is required"),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  ownerName: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { legalName, email, password, ownerName } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const org = await prisma.organization.create({
    data: {
      legalName,
      kybStatus: "PENDING",
      users: {
        create: {
          email: normalizedEmail,
          passwordHash,
          name: ownerName,
          role: "OWNER",
        },
      },
    },
    include: { users: true },
  });

  return NextResponse.json(
    {
      organization: {
        id: org.id,
        legalName: org.legalName,
        kybStatus: org.kybStatus,
      },
      user: {
        id: org.users[0].id,
        email: org.users[0].email,
        role: org.users[0].role,
      },
      message:
        "Account created. Your organization's KYB review is pending — financial features unlock once it's approved.",
    },
    { status: 201 }
  );
}
