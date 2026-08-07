// lib/auth/canManageOrg.ts
//
// Authorization helpers for org-level settings, split into two tiers of
// sensitivity - mirrors lib/auth/canManageBucket.ts's shape:
//
//   - Editing the org profile (legal name) follows the same OWNER/ADMIN
//     bar as bucket management: routine administrative work.
//   - Changing a teammate's role or removing them is OWNER-only. An
//     ADMIN promoting themselves to OWNER, or removing the org's only
//     OWNER, would be a privilege-escalation / lockout bug waiting to
//     happen - so that entire class of action is reserved for OWNER,
//     with no ADMIN exception.

import type { AuthedContext } from "./kyb-gate";

export class OrgPermissionError extends Error {
  constructor(message = "Only an OWNER or ADMIN can edit organization settings.") {
    super(message);
    this.name = "OrgPermissionError";
  }
}

export class OwnerOnlyError extends Error {
  constructor(message = "Only an OWNER can manage team members.") {
    super(message);
    this.name = "OwnerOnlyError";
  }
}

const EDIT_PROFILE_ROLES = new Set(["OWNER", "ADMIN"]);

export function canEditOrgProfile(user: Pick<AuthedContext, "role">): boolean {
  return EDIT_PROFILE_ROLES.has(user.role);
}

export function assertCanEditOrgProfile(user: Pick<AuthedContext, "role">): void {
  if (!canEditOrgProfile(user)) {
    throw new OrgPermissionError();
  }
}

export function assertIsOwner(user: Pick<AuthedContext, "role">): void {
  if (user.role !== "OWNER") {
    throw new OwnerOnlyError();
  }
}