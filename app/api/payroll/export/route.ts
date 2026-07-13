// app/api/payroll/export/route.ts
//
// GET: CSV export scoped by payee and/or date range — the general
// bookkeeping/tax export.
//   ?payeeId=...            -> that payee's full history
//   ?from=...&to=...        -> org-wide, within the date range (by run creation date)
//   ?payeeId=...&from=...&to=... -> that payee, within the date range
//   (no params)             -> org-wide, all time

import { NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { exportPayeeCsv, exportOrgPayrollCsv, PayeeNotFoundError } from "@/lib/payroll/csvExport";

export async function GET(req: Request) {
  try {
    const { orgId } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const payeeId = searchParams.get("payeeId") ?? undefined;
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
    }

    const csv = payeeId
      ? await exportPayeeCsv(orgId, payeeId, { from, to })
      : await exportOrgPayrollCsv(orgId, { from, to });

    const filenameSuffix = payeeId ? `payee-${payeeId}` : "org";
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-${filenameSuffix}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof PayeeNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("[payroll/export] request failed", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}