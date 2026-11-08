// app/api/onramp/sessions/route.ts
//
// Mints a short-lived Onramp session for the signed-in user.
//
// Security notes (do not relax):
//   - createSessionRouteHandler is UNAUTHENTICATED by default. The
//     `authorize` callback below is what keeps strangers from minting
//     sessions with our API key or pointing deposits at their own wallet.
//   - The request must be for the signed-in user's id AND the destination
//     address must belong to that user's organization. The session is
//     never minted for an address supplied by an unauthenticated caller.
//   - referrerDomain is configured server-side from NEXTAUTH_URL /
//     ONRAMP_REFERRER_DOMAIN, never from a request header.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  createAppServerKit,
  createSessionRouteHandler,
} from "@circle-fin/app-kit/server";
import { authOptions } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOnrampServerConfig } from "@/lib/onramp/config";

// Prisma + node-only Circle SDKs are not Edge-compatible.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionHandler = ReturnType<typeof createSessionRouteHandler>;

let cachedHandler: SessionHandler | null = null;

function buildHandler(): SessionHandler | null {
  const config = getOnrampServerConfig();
  if (!config) return null;

  const server = createAppServerKit({
    onramp: {
      apiKey: config.apiKey,
      referrerDomain: config.referrerDomain,
      baseUrl: config.baseUrl,
      widgetBaseUrl: config.widgetBaseUrl,
    },
  });

  return createSessionRouteHandler(server.onramp, {
    authorize: async (request) => {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id || !session.user.orgId) return false;

      type AuthorizeBody = {
        appUserId?: unknown;
        destinationAddress?: unknown;
      };

      let body: AuthorizeBody | null = null;
      try {
        body = (await request.clone().json()) as AuthorizeBody;
      } catch {
        return false;
      }

      if (!body || typeof body.appUserId !== "string") return false;
      if (body.appUserId !== session.user.id) return false;
      if (typeof body.destinationAddress !== "string") return false;

      // The client sends the address verbatim from the wallet row, so an
      // exact match scoped to the org is sufficient — and avoids accepting
      // another organization's address.
      const wallet = await prisma.wallet.findFirst({
        where: {
          orgId: session.user.orgId,
          arcAddress: body.destinationAddress,
        },
        select: { id: true },
      });

      return Boolean(wallet);
    },
    onError: (error, request) => {
      console.error("[onramp] session mint failed", {
        url: request.url,
        error,
      });
    },
  });
}

export async function POST(request: Request) {
  if (!cachedHandler) {
    try {
      cachedHandler = buildHandler();
    } catch (error) {
      console.error("[onramp] configuration error", error);
      return NextResponse.json(
        { error: "Onramp is not configured" },
        { status: 503 }
      );
    }
  }

  if (!cachedHandler) {
    return NextResponse.json(
      { error: "Onramp is not configured" },
      { status: 503 }
    );
  }

  return cachedHandler(request);
}
