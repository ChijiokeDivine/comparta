// app/api/paj/availability/route.ts
// Tells the bank-ramp UI whether it can open, and why not.

import { NextResponse } from "next/server";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { getPajAvailability } from "@/lib/paj/service";
import { pajErrorResponse } from "@/lib/paj/http";

export async function GET() {
  try {
    const { orgId } = await requireApprovedOrg();
    return NextResponse.json(await getPajAvailability(orgId));
  } catch (err) {
    return pajErrorResponse(err);
  }
}
