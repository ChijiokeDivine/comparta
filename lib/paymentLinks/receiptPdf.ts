// lib/paymentLinks/receiptPdf.ts
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";

export class ReceiptNotFoundError extends Error {
  constructor() {
    super("Receipt not found");
    this.name = "ReceiptNotFoundError";
  }
}

export class ReceiptNotReadyError extends Error {
  constructor() {
    super("Payment is not confirmed yet");
    this.name = "ReceiptNotReadyError";
  }
}

export async function buildPaymentReceiptPdf(
  slug: string,
  paymentId: string
): Promise<{ buffer: Buffer; filename: string }> {
  const session = await prisma.paymentLinkPayment.findFirst({
    where: { id: paymentId, paymentLink: { slug } },
    include: {
      paymentLink: {
        include: { organization: { select: { legalName: true } } },
      },
    },
  });

  if (!session) throw new ReceiptNotFoundError();
  if (session.status !== "CONFIRMED" || session.amountPaid == null) {
    throw new ReceiptNotReadyError();
  }

  const amount = toDecimalString(session.amountPaid);
  const orgName = session.paymentLink.organization.legalName;
  const description = session.paymentLink.description?.trim() || "Payment";
  const confirmedAt = session.confirmedAt ?? new Date();
  const ref = session.id;

  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header
  doc
    .fillColor("#2A5CE6")
    .fontSize(16)
    .font("Helvetica-Bold")
    .text("Comparta", { continued: false });

  doc.moveDown(0.3);
  doc
    .fillColor("#7C8CA6")
    .fontSize(10)
    .font("Helvetica")
    .text("Proof of payment");

  doc.moveDown(1.2);
  doc
    .fillColor("#047857")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("PAYMENT CONFIRMED");

  doc.moveDown(1);
  doc
    .fillColor("#0B1E3F")
    .fontSize(28)
    .font("Helvetica-Bold")
    .text(`${amount} USDC`);

  doc.moveDown(1.5);
  doc.strokeColor("#E5E9F2").lineWidth(1).moveTo(56, doc.y).lineTo(539, doc.y).stroke();
  doc.moveDown(1);

  const rows: [string, string][] = [
    ["Paid to", orgName],
    ["Description", description],
    ["Date", confirmedAt.toUTCString()],
    ["Method", session.method === "WALLET" ? "Wallet (USDC)" : "Card / bank"],
    ["Reference", ref],
    ["Link", `comparta.xyz/pay/${slug}`],
  ];

  for (const [label, value] of rows) {
    const y = doc.y;
    doc.fillColor("#7C8CA6").fontSize(10).font("Helvetica").text(label, 56, y, { width: 120 });
    doc.fillColor("#0B1E3F").fontSize(10).font("Helvetica-Bold").text(value, 180, y, { width: 360 });
    doc.moveDown(0.85);
  }

  doc.moveDown(2);
  doc.strokeColor("#E5E9F2").moveTo(56, doc.y).lineTo(539, doc.y).stroke();
  doc.moveDown(1);
  doc
    .fillColor("#B3BDD1")
    .fontSize(9)
    .font("Helvetica")
    .text(
      "This receipt was issued by Comparta. Funds were settled in USDC. Keep this for your records.",
      { width: 480 }
    );

  doc.end();
  const buffer = await done;
  const filename = `comparta-receipt-${ref.slice(0, 8)}.pdf`;
  return { buffer, filename };
}