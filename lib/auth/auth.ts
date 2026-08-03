// lib/auth/auth.ts
//
// NextAuth v4 configuration. Email + password credentials + Google OAuth.
// Session carries orgId, role, and the org's kybStatus so downstream checks
// (see kyb-gate.ts) don't need an extra DB round trip on every request.

import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

/**
 * Custom PrismaAdapter wrapper. The User model has a required `orgId` FK,
 * so a raw OAuth sign-in would fail the PrismaAdapter to create a User
 * without orgId. This override intercepts `createUser` and — for brand-new
 * OAuth-created users — creates a PENDING Organization first and links the
 * new User to it (role OWNER), then proceeds with standard user creation.
 *
 * Credential-signed-up users already go through POST /api/auth/register which
 * creates the Org + User explicitly — never hit this code path.
 *
 * NOTE on typing: `createUser`'s param is typed with only the fields this
 * function actually reads (email/name/emailVerified), rather than the
 * library's `AdapterUser` type. That's deliberate — our own module
 * augmentation in types/next-auth.d.ts adds orgId/role to `AdapterUser`,
 * and because `DefaultAdapterUser` extends `User` (which we also augmented
 * with kybStatus), that requirement leaks transitively into `AdapterUser`
 * too. `@auth/prisma-adapter`'s internal `AdapterUser` reference doesn't
 * see that same augmentation, so the two don't structurally unify — hence
 * the "missing kybStatus, orgId, role" error. Using a minimal structural
 * type here avoids relying on either flavor of `AdapterUser`, and the
 * final cast to `Adapter["createUser"]` reflects the real contract: this
 * function receives a partial OAuth profile and returns a full user,
 * which is exactly what it does.
 */
function CompartaAuthAdapter(): Adapter {
  const base = PrismaAdapter(prisma) as Adapter;

  const createUser = async (user: {
    email: string;
    name?: string | null;
    emailVerified?: Date | null;
  }) => {
    return prisma.$transaction(async (tx) => {
      const emailName = user.email?.split("@")[0] ?? "Unnamed";
      const legalName = user.name ?? emailName;

      const org = await tx.organization.create({
        data: {
          legalName,
          kybStatus: "PENDING",
        },
      });

      return (tx as unknown as typeof prisma).user.create({
        data: {
          email: user.email,
          emailVerified: user.emailVerified ?? null,
          name: user.name ?? null,
          orgId: org.id,
          role: "OWNER",
        },
      });
    });
  };

  return {
    ...base,
    createUser: createUser as Adapter["createUser"],
  };
}

function buildProviders() {
  const env = getEnv();

  // Always include credentials
  const providers: AuthOptions["providers"] = [
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
          image: null,
          orgId: user.orgId,
          role: user.role,
          kybStatus: user.organization.kybStatus,
        };
      },
    }),
  ];

  // Only register Google provider only when the user has configured it —
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      })
    );
  }

  return providers;
}

export const authOptions: AuthOptions = {
  // Custom adapter so OAuth new users get an Org auto-created (see docstring above)
  adapter: CompartaAuthAdapter(),
  session: { strategy: "jwt" },
  secret: getEnv().NEXTAUTH_SECRET,

  providers: buildProviders(),

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.orgId = user.orgId;
        token.role = user.role;

        if (typeof user.kybStatus !== "undefined") {
          // Credentials flow already passed kybStatus via authorize()
          token.kybStatus = user.kybStatus;
        } else {
          // OAuth flow: custom createUser wrote user.orgId; fetch kybStatus once
          const org = await prisma.organization.findUnique({
            where: { id: user.orgId },
            select: { kybStatus: true },
          });
          token.kybStatus = org?.kybStatus ?? "PENDING";
        }
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
    newUser: "/register",
  },
};