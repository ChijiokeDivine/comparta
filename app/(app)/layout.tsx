// app/(app)/layout.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import Providers from "./_components/Providers";
import AppShell from "./_components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // middleware.ts already enforces auth on every matched route, but this
  // guard is cheap defense-in-depth for anything rendered inside this
  // group and keeps the layout safe to reuse if the matcher list changes.
  const session = await getServerSession(authOptions);
  if (!session?.user?.orgId) {
    redirect("/login");
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.user.orgId },
    select: { legalName: true, kybStatus: true },
  });

  if (!org) {
    redirect("/login");
  }

  return (
    <Providers session={session}>
      <AppShell orgName={org.legalName} kybStatus={org.kybStatus}>
        {children}
      </AppShell>
    </Providers>
  );
}