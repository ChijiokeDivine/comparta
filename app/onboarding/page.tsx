// app/onboarding/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import OnboardingForm from "./OnboardingForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finish setting up your account",
};

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) redirect("/login");
  if (session.user.onboardingCompleted) redirect("/dashboard");

  return (
    <Suspense fallback={null}>
      <OnboardingForm />
    </Suspense>
  );
}
