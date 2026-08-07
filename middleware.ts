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

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
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