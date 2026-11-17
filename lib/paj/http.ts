// lib/paj/http.ts
//
// One error → HTTP response mapper for every /api/paj route. Keeps the
// route files small and makes Paj's failures consistent.

import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { PajApiError } from "./client";
import { PajServiceError } from "./service";

export function pajErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof PajServiceError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  if (err instanceof PajApiError) {
    console.error("[paj] upstream request failed", {
      status: err.status,
      message: err.message,
    });
    return NextResponse.json(
      {
        error:
          err.status === 401
            ? "Paj rejected our API credentials."
            : err.message,
        code: "PAJ_UPSTREAM_ERROR",
      },
      { status: 502 }
    );
  }
  console.error("[paj] unexpected failure", err);
  return NextResponse.json(
    { error: "Bank transfer failed. Please try again." },
    { status: 500 }
  );
}
