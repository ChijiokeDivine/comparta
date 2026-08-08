import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import LoginForm from "./LoginForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.orgId) redirect("/dashboard");

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}