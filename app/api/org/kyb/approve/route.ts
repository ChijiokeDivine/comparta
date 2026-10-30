// app/api/org/kyb/approve/route.ts
//
// Manual KYB-approval stub, per Phase 0 spec: "admin flips a status
// field." No real KYB provider is integrated yet.
//
// Gated by a shared ADMIN_API_SECRET header rather than a user session,
// since there is no internal admin dashboard/role yet — a business must
// never be able to approve its own KYB. Swap this for real admin auth (or
// a KYB provider webhook) when that lands.
//
// On approval: provisions the org's single Circle Developer-Controlled
// Wallet on Arc, then creates the four default LedgerAccount buckets
// (Operating, Tax Reserve, Payroll, Savings), all backed by that one
// wallet.
//
// Re-provisioning: an already-APPROVED org may POST this again — that is the
// supported hook after a testnet → mainnet cutover (see
// scripts/cleanupStaleNetworkData.ts). Provisioning is idempotent per active
// chain, so it only creates a wallet when the org has none on this network.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { provisionOrgWallet } from "@/lib/org/provisioning";

const approveSchema = z.object({
  orgId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  approvedByAdminId: z.string().min(1).default("system"),
});

export async function POST(req: Request) {
  const adminSecret = req.headers.get("x-admin-secret");
  if (!adminSecret || adminSecret !== getEnv().ADMIN_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orgId, decision, approvedByAdminId } = parsed.data;

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }
  if (org.kybStatus === "REJECTED") {
    return NextResponse.json(
      { error: `Organization KYB status is ${org.kybStatus}; create a new organization instead` },
      { status: 409 }
    );
  }
  // An APPROVED org may call this endpoint again on purpose: after a
  // testnet → mainnet cutover (or a wiped wallet row) it is the manual
  // re-provisioning hook. provisionOrgWallet is idempotent per active chain,
  // so this only creates a wallet when the org has none ON THIS NETWORK.
  if (decision === "REJECTED" && org.kybStatus === "APPROVED") {
    return NextResponse.json(
      { error: "Organization is already APPROVED; refusing to reject it here" },
      { status: 409 }
    );
  }

  if (decision === "REJECTED") {
    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { kybStatus: "REJECTED", kybApprovedBy: approvedByAdminId },
    });
    return NextResponse.json({ organization: { id: updated.id, kybStatus: updated.kybStatus } });
  }

  // APPROVED path: provision wallet + default buckets (idempotent — a
  // no-op if demo mode already provisioned this org at signup, see
  // lib/config/demoMode.ts), then flip status. These are two separate
  // writes rather than one shared transaction now that provisioning is
  // extracted into lib/org/provisioning.ts; if the status update below
  // fails after a successful provision, the org is left with a wallet
  // but kybStatus still PENDING — retrying this same call is safe and
  // will just pick up the existing wallet on its next attempt.
  try {
    const { wallet, ledgerAccounts } = await provisionOrgWallet(orgId);

    const updatedOrg =
      org.kybStatus === "APPROVED"
        ? org
        : await prisma.organization.update({
            where: { id: orgId },
            data: {
              kybStatus: "APPROVED",
              kybApprovedAt: new Date(),
              kybApprovedBy: approvedByAdminId,
            },
          });

    return NextResponse.json({
      organization: { id: updatedOrg.id, kybStatus: updatedOrg.kybStatus },
      wallet: { id: wallet.id, arcAddress: wallet.arcAddress },
      ledgerAccounts: ledgerAccounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    });
  } catch (err) {
    console.error(`[kyb-approve] provisioning or status update failed for org ${orgId}`, err);
    return NextResponse.json(
      {
        error:
          "Wallet provisioning or status update failed. This has been logged for manual reconciliation.",
      },
      { status: 500 }
    );
  }
}