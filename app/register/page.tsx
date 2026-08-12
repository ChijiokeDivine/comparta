import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import RegisterForm from "./RegisterForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
};

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: session.user.orgId },
      select: { id: true },
    });
    if (org) redirect("/dashboard");
  }

  return <RegisterForm />;
}
