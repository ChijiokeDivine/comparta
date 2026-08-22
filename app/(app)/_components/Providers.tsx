// app/providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { HideBalancesProvider } from "./HideBalancesProvider";
// or move HideBalancesProvider to app/_components/ to avoid importing from a route group

export function Providers({
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