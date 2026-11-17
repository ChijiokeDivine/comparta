// app/api/paj/onramp/route.ts
// Opens a naira → USDC order and returns the virtual account to pay.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedOrg } from "@/lib/auth/kyb-gate";
import { createOnrampOrder } from "@/lib/paj/service";
import { pajErrorResponse } from "@/lib/paj/http";

const schema = z.object({
  fiatAmount: z.coerce.number().positive("Enter an amount."),
  chain: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const { orgId } = await requireApprovedOrg();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const order = await createOnrampOrder({
      orgId,
      fiatAmount: parsed.data.fiatAmount,
      chainId: parsed.data.chain,
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    return pajErrorResponse(err);
  }
}
