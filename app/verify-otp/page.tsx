import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import VerifyOtpForm from "./VerifyOtpForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify Code",
};

export default async function VerifyOtpPage() {
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
      <VerifyOtpForm />
    </Suspense>
  );
}
