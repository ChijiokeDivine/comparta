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
 * without orgId. This override intercepts `createUser` and - for brand-new
 * OAuth-created users - creates a PENDING Organization first and links the
 * new User to it (role OWNER), then proceeds with standard user creation.
 *
 * Credential-signed-up users already go through POST /api/auth/register which
 * creates the Org + User explicitly - never hit this code path.
 *
 * NOTE on typing: `createUser`'s param is typed with only the fields this
 * function actually reads (email/name/emailVerified), rather than the
 * library's `AdapterUser` type. That's deliberate - our own module
 * augmentation in types/next-auth.d.ts adds orgId/role to `AdapterUser`,
 * and because `DefaultAdapterUser` extends `User` (which we also augmented
 * with kybStatus), that requirement leaks transitively into `AdapterUser`
 * too. `@auth/prisma-adapter`'s internal `AdapterUser` reference doesn't
 * see that same augmentation, so the two don't structurally unify - hence
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

        // New credential sign-ups require email verification via the 6-digit
        // OTP flow (/register → /verify-otp).  Throw a descriptive error so
        // LoginForm surfaces the message directly (see LoginForm.tsx line ~147:
        // non-"CredentialsSignin" errors are rendered verbatim).
        //
        // NOTE: Google/OAuth sign-ins bypass this authorize() entirely and
        // get emailVerified set by Google via the OAuth profile + our custom
        // adapter — they never hit this gate.
        if (!user.emailVerified) {
          throw new Error(
            "Please verify your email first. Check your inbox for the verification code, or request a new one."
          );
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: null,
          orgId: user.orgId,
          role: user.role,
          kybStatus: user.organization.kybStatus,
          onboardingCompleted: user.onboardingCompleted,
        };
      },
    }),
  ];

  // Only register Google provider only when the user has configured it -
  // but log a loud warning at boot if they're missing so this is easy to
  // spot in production server logs instead of appearing as a silent
  // "redirect back to /login?callbackUrl=" with no error param.
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Explicit endpoint config bypasses Google's
        // .well-known/openid-configuration discovery round-trip.  Discovery
        // is the source of occasional 400s / CORS / IPv6 timeouts on
        // restricted server networks and on some bare-www domain splits
        // where the issuer claim mismatches the discovered host.  These
        // endpoints are Google's stable published URLs.
        authorization: {
          url: "https://accounts.google.com/o/oauth2/v2/auth",
          params: {
            scope: "openid email profile",
            prompt: "consent",
            access_type: "offline",
            response_type: "code",
          },
        },
        token: "https://oauth2.googleapis.com/token",
        userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
        issuer: "https://accounts.google.com",
      })
    );
  } else if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[auth] GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET are not set — " +
      "Google OAuth provider is NOT registered.  signIn('google') will " +
      "redirect back to /login?callbackUrl=... with no error param."
    );
  }

  return providers;
}

export const authOptions: AuthOptions = {
  // Custom adapter so OAuth new users get an Org auto-created (see docstring above)
  adapter: CompartaAuthAdapter(),
  session: { strategy: "jwt" },
  secret: getEnv().NEXTAUTH_SECRET,

  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.callback-url"
          : "next-auth.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-next-auth.csrf-token"
          : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },

  providers: buildProviders(),

  callbacks: {
    async jwt({ token, user, trigger, session: updateSession }) {
      // Client-side `update()` calls from OnboardingForm / other pages pass
      // an arbitrary session-shaped object via `trigger === "update"`.
      // This is how OnboardingForm flips onboardingCompleted=true right
      // after submitting without forcing a full re-login.  We also accept
      // `kybStatus` here so the API route can push "APPROVED" into the
      // token immediately after provisioning (otherwise the user sees the
      // org "under review" until next full sign-in).
      if (trigger === "update" && updateSession) {
        if (typeof (updateSession as { onboardingCompleted?: boolean }).onboardingCompleted === "boolean") {
          token.onboardingCompleted = (updateSession as { onboardingCompleted: boolean }).onboardingCompleted;
        }
        if (typeof (updateSession as { kybStatus?: string }).kybStatus === "string") {
          token.kybStatus = (updateSession as { kybStatus: string }).kybStatus as never;
        }
      }

      if (user) {
        token.orgId = user.orgId;
        token.role = user.role;
        token.onboardingCompleted = user.onboardingCompleted;

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
        if (typeof token.onboardingCompleted === "boolean") {
          session.user.onboardingCompleted = token.onboardingCompleted;
        }
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // NextAuth calls this before redirecting the user after any sign-in,
      // sign-out, or session callback page. We can't read the session from
      // inside the redirect callback (it hasn't been written yet on the
      // sign-in path), but we still need Google sign-ups to land on
      // /onboarding instead of /dashboard so they can't skip collecting the
      // org legal name.
      //
      // Strategy: if the configured callback is /dashboard (or any of the
      // protected app routes), we replace it with /onboarding. The
      // OnboardingForm itself already contains the "are we already done?"
      // gate and forwards completed users to /dashboard, so even a user
      // who has finished onboarding won't get stuck here.
      const protectedRoots = [
        "/dashboard",
        "/wallet",
        "/invoices",
        "/payroll",
        "/savings",
        "/contacts",
        "/buckets",
        "/payment-links",
        "/allocation-rules",
        "/recurring",
        "/insights",
        "/settings",
      ];
      const isProtected = (candidate: string) => {
        try {
          const u = new URL(candidate, baseUrl);
          return protectedRoots.some((r) => u.pathname === r || u.pathname.startsWith(`${r}/`));
        } catch {
          return false;
        }
      };
      if (isProtected(url)) {
        const onboardingUrl = new URL("/onboarding", baseUrl).toString();
        return onboardingUrl;
      }
      // Default behaviour: allow absolute URLs that share our origin,
      // otherwise bounce to the base URL root.
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === new URL(baseUrl).origin) return url;
      } catch {
        // fall through
      }
      return baseUrl;
    },
  },

  pages: {
    signIn: "/login",
    newUser: "/register",
  },
};