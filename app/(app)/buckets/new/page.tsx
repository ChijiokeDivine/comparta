// app/(app)/buckets/new/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { KybBanner } from "../../_components/Kyb";
import NewBucketForm from "./NewBucketForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New bucket",
};

export default async function NewBucketPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";
  if (!canManage) redirect("/buckets");

  const org = await prisma.organization.findUnique({
    where: { id: session.user.orgId },
    select: { kybStatus: true },
  });
  if (!org) redirect("/login");

  return (
    <div className="max-w-lg space-y-6">
      <KybBanner status={org.kybStatus} />
      <h1 className="text-xl font-semibold text-[#0B1E3F]">New bucket</h1>
      <NewBucketForm disabled={org.kybStatus !== "APPROVED"} />
    </div>
  );
}