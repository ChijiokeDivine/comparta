import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import ForgotPasswordForm from "./ForgotPasswordForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password",
};

export default async function ForgotPasswordPage() {
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
      <ForgotPasswordForm />
    </Suspense>
  );
}
