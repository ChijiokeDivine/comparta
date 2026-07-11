// lib/auth/auth.ts
//
// NextAuth v4 configuration. Email + password credentials, backed by the
// User table. Session carries orgId, role, and the org's kybStatus so
// downstream checks (see kyb-gate.ts) don't need an extra DB round trip
// on every request.

import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

export const authOptions: AuthOptions = {
  // NOTE: PrismaAdapter is used for session/account persistence if you
  // later add OAuth providers. Credentials-based sign-in below uses JWT
  // sessions (the adapter's database-session strategy does not support
  // the Credentials provider per NextAuth's own constraints).
  adapter: PrismaAdapter(prisma) as AuthOptions["adapter"],
  session: { strategy: "jwt" },
  secret: getEnv().NEXTAUTH_SECRET,

  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          include: { organization: true },
        });

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          orgId: user.orgId,
          role: user.role,
          kybStatus: user.organization.kybStatus,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.orgId = user.orgId;
        token.role = user.role;
        token.kybStatus = user.kybStatus;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        if (token.orgId) session.user.orgId = token.orgId;
        if (token.role) session.user.role = token.role;
        if (token.kybStatus) session.user.kybStatus = token.kybStatus;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
};
