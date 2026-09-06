// app/api/pay/[slug]/session/[paymentId]/receipt/route.ts
import {
  buildPaymentReceiptPdf,
  ReceiptNotFoundError,
  ReceiptNotReadyError,
} from "@/lib/paymentLinks/receiptPdf";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; paymentId: string }> }
) {
  try {
    const { slug, paymentId } = await params;
    const { buffer, filename } = await buildPaymentReceiptPdf(slug, paymentId);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ReceiptNotFoundError) {
      return new Response("Receipt not found", { status: 404 });
    }
    if (err instanceof ReceiptNotReadyError) {
      return new Response("Payment is not confirmed yet", { status: 409 });
    }
    console.error("[pay] receipt download failed", err);
    return new Response("Failed to generate receipt", { status: 500 });
  }
}