// lib/config/demoMode.ts
//
// Hackathon-era shortcut, now restricted to non-production deployments.
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
// and immediately receive a live, custody-capable wallet. That is not a
// setting a real-money deployment should inherit by default.
//
// Precedence:
//   1. DEMO_KYB_APPROVED=true|false  — explicit operator override
//   2. mainnet deployment            — always off
//   3. Vercel production deployment  — off
//   4. anything else (dev/preview)   — on

function resolveDemoMode(): boolean {
  const explicit = process.env.DEMO_KYB_APPROVED;
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  // Mainnet means real money: never auto-approve, regardless of how the
  // deployment is labelled.
  if (process.env.NEXT_PUBLIC_APP_NETWORK === "mainnet") return false;

  // On Vercel, a "production" deployment is the only one that serves real
  // traffic — previews are deliberately sandbox-like.
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV !== "production";

  // Self-hosted: fall back to NODE_ENV. `next dev` is development.
  return process.env.NODE_ENV !== "production";
}

/**
 * Resolved at module load: once per server process, and once per build for
 * client bundles (Next inlines `NODE_ENV` / `NEXT_PUBLIC_*`).
 */
export const DEMO_KYB_APPROVED: boolean = resolveDemoMode();
