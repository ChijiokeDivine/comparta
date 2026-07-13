// app/api/payroll/runs/[id]/export/route.ts
//
// GET: CSV of a single run's line items, for bookkeeping/tax purposes.

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { exportRunCsv, PayrollRunNotFoundError } from "@/lib/payroll/csvExport";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireAuth();
    const csv = await exportRunCsv(orgId, id);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-run-${id}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof PayrollRunNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("[payroll/runs/:id/export] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}