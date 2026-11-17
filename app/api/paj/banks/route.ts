// app/api/paj/banks/route.ts
// Nigerian banks available for payouts. Cached server-side.

import { NextResponse } from "next/server";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { listPajBanks } from "@/lib/paj/api";
import { pajErrorResponse } from "@/lib/paj/http";

export async function GET(req: Request) {
  try {
    await requireApprovedOrg();
    const q = new URL(req.url).searchParams.get("q") ?? undefined;
    const banks = await listPajBanks(q);
    return NextResponse.json({
      banks: banks.map((bank) => ({
        code: bank.code,
        name: bank.name,
        logo: bank.logo ?? null,
      })),
    });
  } catch (err) {
    return pajErrorResponse(err);
  }
}
