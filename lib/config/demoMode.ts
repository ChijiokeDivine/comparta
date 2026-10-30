// lib/config/demoMode.ts
//
// Hackathon-era shortcut, now restricted to non-production builds.
//
// When true:
//   - POST /api/auth/register creates new orgs with kybStatus: "APPROVED"
//     instead of "PENDING", and kicks off wallet + default-bucket
//     provisioning (see lib/org/provisioning.ts) in the background right
//     after signup - no manual KYB step needed to start using the app.
//   - POST /api/onboarding does the same for Google OAuth sign-ups.
//
// When false (production):
//   - New orgs stay PENDING, no Circle wallet is provisioned at signup, and
//     every financial action is disabled behind the existing KYB gate
//     (app/(app)/_components/Kyb.tsx) until an operator approves the org
//     with POST /api/org/kyb/approve (x-admin-secret header), which is what
//     provisions the wallet.
//
// WHY THIS IS GATED NOW: Comparta runs on Arc MAINNET in production. The
// demo shortcut let anyone who could fill in a signup form self-approve KYB
// and immediately receive a live, funded-capable custody wallet. That is not
// a setting a real-money deployment should ever inherit by default.
//
// To run the instant-approval flow against mainnet anyway (e.g. a
// deliberately staged demo), set DEMO_KYB_APPROVED=true in that environment
// rather than editing this file.

/**
 * Resolved at module load, which for server code means once per process and
 * for client code means once per build (Next inlines `NODE_ENV`). Never
 * throws: a missing value is treated as "not production" only when
 * NODE_ENV is also missing, so an unconfigured deploy fails closed.
 */
export const DEMO_KYB_APPROVED: boolean =
  process.env.DEMO_KYB_APPROVED === "true" ||
  (process.env.DEMO_KYB_APPROVED !== "false" &&
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL_ENV !== "production");
