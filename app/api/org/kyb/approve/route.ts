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

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { createWalletForOrg } from "@/lib/circle/wallets";

const approveSchema = z.object({
  orgId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  approvedByAdminId: z.string().min(1).default("system"),
});

const DEFAULT_LEDGER_BUCKETS = [
  { name: "Operating", type: "OPERATING" as const },
  { name: "Tax Reserve", type: "RESERVE" as const },
  { name: "Payroll", type: "PAYROLL" as const },
  { name: "Savings", type: "SAVINGS" as const },
];

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
  if (org.kybStatus !== "PENDING") {
    return NextResponse.json(
      { error: `Organization KYB status is already ${org.kybStatus}` },
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

  // APPROVED path: provision wallet + default buckets, then flip status.
  // Circle call happens outside the DB transaction (it's a network call to
  // a third party and shouldn't hold a Postgres transaction open); if the
  // subsequent DB writes fail we log loudly rather than silently orphaning
  // a Circle wallet with no local record.
  const wallet = await createWalletForOrg(orgId);

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedOrg = await tx.organization.update({
        where: { id: orgId },
        data: {
          kybStatus: "APPROVED",
          kybApprovedAt: new Date(),
          kybApprovedBy: approvedByAdminId,
        },
      });

      const walletRow = await tx.wallet.create({
        data: {
          orgId,
          circleWalletId: wallet.circleWalletId,
          arcAddress: wallet.arcAddress,
          chain: wallet.chain === "ARC" ? "ARC_MAINNET" : "ARC_TESTNET",
        },
      });

      const ledgerAccounts = await Promise.all(
        DEFAULT_LEDGER_BUCKETS.map((bucket) =>
          tx.ledgerAccount.create({
            data: {
              orgId,
              walletId: walletRow.id,
              name: bucket.name,
              type: bucket.type,
            },
          })
        )
      );

      return { updatedOrg, walletRow, ledgerAccounts };
    });

    return NextResponse.json({
      organization: { id: result.updatedOrg.id, kybStatus: result.updatedOrg.kybStatus },
      wallet: { id: result.walletRow.id, arcAddress: result.walletRow.arcAddress },
      ledgerAccounts: result.ledgerAccounts.map((a: { id: string; name: string; type: string }) => ({ id: a.id, name: a.name, type: a.type })),
    });
  } catch (err) {
    console.error(
      `[kyb-approve] CRITICAL: Circle wallet ${wallet.circleWalletId} (${wallet.arcAddress}) ` +
        `was created for org ${orgId} but the follow-up DB write failed. Manual reconciliation needed.`,
      err
    );
    return NextResponse.json(
      {
        error:
          "Wallet was provisioned on Circle but saving it locally failed. This has been logged for manual reconciliation.",
      },
      { status: 500 }
    );
  }
}
