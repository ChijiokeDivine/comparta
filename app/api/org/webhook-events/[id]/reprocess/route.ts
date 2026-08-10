// app/api/org/webhook-events/[id]/reprocess/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, UnauthenticatedError } from "@/lib/auth/kyb-gate";
import { assertIsOwner, OwnerOnlyError } from "@/lib/auth/canManageOrg";
import { handleInboundTransfer, type InboundNotification } from "@/lib/transfers/receive";

interface WalletTransferPayload {
  notificationType?: string;
  notification?: {
    id?: string;
    blockchain?: string;
    sourceBlockchain?: string;
    walletId?: string;
    destinationAddress?: string;
    sourceAddress?: string;
    tokenId?: string;
    amounts?: string[];
    state?: string;
    status?: string;
    txHash?: string;
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireAuth();
    assertIsOwner(ctx);

    const event = await prisma.webhookEvent.findUnique({ where: { id } });
    if (!event) {
      return NextResponse.json({ error: "Webhook event not found" }, { status: 404 });
    }

    const payload = event.rawPayload as WalletTransferPayload;
    const isWalletTransfer =
      typeof payload === "object" && payload !== null && "notification" in payload && !("payment" in payload);

    if (!isWalletTransfer || payload.notificationType !== "transactions.inbound" || !payload.notification) {
      return NextResponse.json(
        {
          error:
            "This event isn't a reprocessable inbound wallet-transfer notification (or its shape isn't recognized). " +
            "Only transactions.inbound events can be reprocessed here today.",
        },
        { status: 422 }
      );
    }

    const n = payload.notification;
    if (!n.id || !n.walletId || !n.blockchain || !n.amounts) {
      return NextResponse.json({ error: "Stored payload is missing required fields" }, { status: 422 });
    }

    const inbound: InboundNotification = {
      circleTransactionId: n.id,
      walletId: n.walletId,
      tokenId: n.tokenId,
      blockchain: n.blockchain,
      sourceBlockchain: n.sourceBlockchain,
      destinationAddress: n.destinationAddress ?? "",
      sourceAddress: n.sourceAddress,
      amounts: n.amounts,
      state: n.state ?? n.status ?? "UNKNOWN",
      txHash: n.txHash,
      rawPayload: payload,
    };

    // handleInboundTransfer is idempotent on circleTransactionId — calling
    // this twice (e.g. a double-click) can never double-credit the ledger.
    await handleInboundTransfer(inbound);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), processError: null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof OwnerOnlyError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[org/webhook-events] reprocess failed", err);
    return NextResponse.json({ error: "Reprocessing failed" }, { status: 500 });
  }
}