import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";
import RegisterForm from "./RegisterForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
};

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.orgId) redirect("/dashboard");

  return <RegisterForm />;
}
