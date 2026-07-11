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
      authorized: ({ token }) => !!token,
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
    "/api/wallet/:path*",
    "/api/ledger/:path*",
    "/api/org/:path*",
  ],
};
