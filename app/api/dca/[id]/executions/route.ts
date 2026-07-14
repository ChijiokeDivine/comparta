// app/api/dca/[id]/executions/route.ts
//
// GET: full execution history for one recurring transfer, newest first —
// every attempted cycle including FAILED_INSUFFICIENT_FUNDS and
// FAILED_OTHER rows, so "why didn't this run" is always answerable
// directly from this endpoint. Any authenticated org member.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import {
  listRecurringTransferExecutions,
  RecurringTransferNotFoundError,
} from "@/lib/dca/service";
import { serializeRecurringTransferExecution } from "@/lib/dca/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();

    const executions = await listRecurringTransferExecutions(orgId, id);
    return NextResponse.json({ executions: executions.map(serializeRecurringTransferExecution) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof RecurringTransferNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[dca/:id/executions] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}