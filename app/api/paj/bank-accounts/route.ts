// app/api/paj/bank-accounts/route.ts
// Saved Nigerian beneficiaries. POST registers (and confirms) an account
// with Paj, then stores it for reuse at payout time.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import {
  listPajBankAccounts,
  registerPajBankAccount,
} from "@/lib/paj/service";
import { pajErrorResponse } from "@/lib/paj/http";

const createSchema = z.object({
  bankCode: z.string().min(1, "Choose a bank."),
  accountNumber: z.string().regex(/^\d{10}$/, "Enter a 10-digit account number."),
});

export async function GET() {
  try {
    const { orgId } = await requireApprovedOrg();
    const bankAccounts = await listPajBankAccounts(orgId);
    return NextResponse.json({ bankAccounts });
  } catch (err) {
    return pajErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const bankAccount = await registerPajBankAccount({
      orgId,
      ...parsed.data,
    });
    return NextResponse.json({ bankAccount }, { status: 201 });
  } catch (err) {
    return pajErrorResponse(err);
  }
}
