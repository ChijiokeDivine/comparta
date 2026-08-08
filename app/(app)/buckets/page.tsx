// app/(app)/buckets/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { listBucketsWithBalances } from "@/lib/buckets/service";
import BucketsGridClient from "./_components/BucketsGridClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Buckets",
};

export default async function BucketsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) redirect("/login");

  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const buckets = await listBucketsWithBalances(session.user.orgId, { includeSparkline: false });

  return <BucketsGridClient buckets={buckets} canManage={canManage} />;
}
