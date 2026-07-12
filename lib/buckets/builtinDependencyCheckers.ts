// lib/buckets/builtinDependencyCheckers.ts
//
// Registers the dependency checks this phase owns. Imported once, for its
// side effect, from lib/buckets/service.ts — see dependencies.ts for why
// this indirection exists (so future Payroll/DCA modules can add their
// own checkers without this file or buckets/service.ts ever importing
// them back).

import { prisma } from "@/lib/db/prisma";
import { registerBucketDependencyChecker } from "./dependencies";

// A bucket that is the org's configured default receiving account for
// unmatched inbound payments (see lib/transfers/receive.ts) can't be
// archived out from under that config — the next inbound transfer would
// have nowhere to land.
registerBucketDependencyChecker(async (orgId, ledgerAccountId) => {
  const org = await prisma.organization.findFirst({
    where: { id: orgId, defaultLedgerAccountId: ledgerAccountId },
    select: { id: true },
  });
  return org ? { label: "the organization's default receiving bucket", count: 1 } : null;
});

// Active allocation rules referencing this bucket as either source or
// target — an archived bucket with a live rule pointing at it would
// either silently stop allocating (source) or accumulate funds nobody's
// watching (target).
registerBucketDependencyChecker(async (orgId, ledgerAccountId) => {
  const count = await prisma.allocationRule.count({
    where: {
      orgId,
      active: true,
      OR: [{ sourceLedgerAccountId: ledgerAccountId }, { targetLedgerAccountId: ledgerAccountId }],
    },
  });
  return count > 0 ? { label: `${count} active allocation rule(s)`, count } : null;
});

// Payment links still capable of receiving money (ACTIVE or PAUSED — a
// PAUSED link can be resumed by the merchant at any time, so it still
// counts as a live dependency; EXPIRED links are terminal and don't
// block archival).
registerBucketDependencyChecker(async (orgId, ledgerAccountId) => {
  const count = await prisma.paymentLink.count({
    where: { orgId, receivingLedgerAccountId: ledgerAccountId, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  return count > 0 ? { label: `${count} active or paused payment link(s)`, count } : null;
});
