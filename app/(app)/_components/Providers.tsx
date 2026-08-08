// app/(app)/_components/Providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { HideBalancesProvider } from "./HideBalancesProvider";

export default function Providers({
  session,
  children,
}: {
  session: Session | null;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider session={session}>
      <HideBalancesProvider>{children}</HideBalancesProvider>
    </SessionProvider>
  );
}