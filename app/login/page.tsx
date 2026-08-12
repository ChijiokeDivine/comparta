import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import LoginForm from "./LoginForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: session.user.orgId },
      select: { id: true },
    });
    if (org) redirect("/dashboard");
  }

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}