// lib/config/demoMode.ts
//
// Hackathon-only shortcut. When true:
//   - POST /api/auth/register creates new orgs with kybStatus: "APPROVED"
//     instead of "PENDING", and kicks off wallet + default-bucket
//     provisioning (see lib/org/provisioning.ts) in the background right
//     after signup - no manual KYB step needed to start using the app.
//
// To restore the real KYB flow (org sits at PENDING until POST
// /api/org/kyb/approve is called), flip this single constant back to
// false. Nothing else needs to change - app/api/auth/register/route.ts
// and app/api/org/kyb/approve/route.ts both branch on this flag, and
// lib/org/provisioning.ts#provisionOrgWallet is idempotent either way
// (safe to call from both places without ever double-provisioning).
export const DEMO_KYB_APPROVED = true;