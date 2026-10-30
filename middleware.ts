// middleware.ts
//
// Edge-safe session check for protected app routes. This only verifies
// the user is signed in — it deliberately does NOT check KYB status here,
// because that requires a Postgres read and Prisma doesn't run reliably
// on the Edge runtime. The real KYB gate (lib/auth/kyb-gate.ts) runs
// server-side inside each financial API route/handler and re-reads
// kybStatus fresh from the DB on every call.

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Keep this in sync with authOptions.cookies.sessionToken.name in
// lib/auth/auth.ts. next-auth's withAuth() otherwise guesses the cookie name
// from NEXTAUTH_URL (`https://` prefix) or `process.env.VERCEL`, so a stale
// NEXTAUTH_URL (e.g. http://localhost:3000 copied into a Vercel env) makes the
// middleware look for `next-auth.session-token` while the server writes
// `__Secure-next-auth.session-token` — the user is then bounced between
// /dashboard and /login forever (ERR_TOO_MANY_REDIRECTS).
const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    secret: process.env.NEXTAUTH_SECRET,
    cookies: {
      sessionToken: { name: SESSION_COOKIE_NAME },
    },
    callbacks: {
      // /invoices/pay/[invoiceId] is the one deliberately public route
      // under /invoices — the payer opening it has no Comparta account
      // at all, so it can never require a token. Every other path this
      // matcher covers (including the rest of /invoices/*) still does.
      authorized: ({ token, req }) => {
        if (req.nextUrl.pathname.startsWith("/invoices/pay/")) return true;
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/wallet/:path*",
    "/invoices/:path*",
    "/payroll/:path*",
    "/savings/:path*",
    "/contacts/:path*",
    "/buckets/:path*",
    "/payment-links/:path*",
    "/allocation-rules/:path*",
    "/recurring/:path*",
    "/insights/:path*",
    "/settings/:path*",
    "/api/wallet/:path*",
    "/api/ledger/:path*",
    "/api/org/:path*",
  ],
};