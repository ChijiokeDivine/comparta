// app/api/paj/webhook/route.ts
//
// OWNER-only control surface for the Paj ramp webhook:
//   GET  → current endpoint/secret/registration diagnostics (never the secret)
//   POST → { action: "register" } points the API key's rampWebhookURL here and
//          stores the returned signing secret; { action: "test" } asks Paj to
//          POST a signed sample delivery, so verification is proven end-to-end.
//
// This is what replaces "paste a URL into the dashboard and hope": the URL is
// registered through Paj's own API and the test delivery exercises the real
// signature path.

import { NextResponse } from "next/server";
import { z } from "zod";
import { assertIsOwner, OwnerOnlyError } from "@/lib/auth/canManageOrg";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import {
  getPajWebhookDiagnostics,
  PajWebhookConfigError,
  registerPajWebhook,
  sendPajWebhookTest,
} from "@/lib/paj/webhookConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["register", "test"]),
});

function errorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof OwnerOnlyError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof PajWebhookConfigError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  console.error("[paj/webhook-settings] unexpected failure", err);
  return NextResponse.json(
    { error: "Webhook settings request failed." },
    { status: 500 }
  );
}

export async function GET() {
  try {
    const ctx = await requireAuth();
    assertIsOwner(ctx);
    return NextResponse.json(await getPajWebhookDiagnostics());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth();
    assertIsOwner(ctx);

    const body = await req.json().catch(() => null);
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Send { "action": "register" } or { "action": "test" }.' },
        { status: 400 }
      );
    }

    if (parsed.data.action === "register") {
      const registration = await registerPajWebhook();
      return NextResponse.json({
        registration,
        diagnostics: await getPajWebhookDiagnostics(),
      });
    }

    const result = await sendPajWebhookTest();
    return NextResponse.json({
      result,
      diagnostics: await getPajWebhookDiagnostics(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
