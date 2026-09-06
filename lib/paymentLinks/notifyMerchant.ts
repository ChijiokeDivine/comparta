// lib/paymentLinks/notifyMerchant.ts
// Best-effort merchant email after a payment-link payment is CONFIRMED.
// Never throw into the settlement path.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import { sendPaymentReceivedEmail } from "@/lib/notifications/notify";

export async function notifyMerchantPaymentLinkPaid(
  paymentLinkPaymentId: string,
  publicBaseUrl: string
): Promise<void> {
  try {
    const session = await prisma.paymentLinkPayment.findUnique({
      where: { id: paymentLinkPaymentId },
      include: {
        paymentLink: {
          include: {
            organization: {
              select: {
                id: true,
                legalName: true,
                users: {
                  where: { role: { in: ["OWNER", "ADMIN"] } },
                  select: { email: true },
                },
              },
            },
          },
        },
      },
    });

    if (!session || session.status !== "CONFIRMED" || session.amountPaid == null) {
      return;
    }

    const emails = [
      ...new Set(
        session.paymentLink.organization.users
          .map((u) => u.email?.trim().toLowerCase())
          .filter((e): e is string => !!e)
      ),
    ];

    const base = publicBaseUrl.replace(/\/$/, "");

    await sendPaymentReceivedEmail({
      orgLegalName: session.paymentLink.organization.legalName,
      recipientEmails: emails,
      amount: toDecimalString(session.amountPaid),
      currency: "USDC",
      description: session.paymentLink.description,
      paymentId: session.id,
      linkSlug: session.paymentLink.slug,
      confirmedAt: session.confirmedAt ?? new Date(),
      method: session.method,
      dashboardUrl: `${base}/payment-links/${session.paymentLink.id}`,
    });
  } catch (err) {
    console.error(
      `[paymentLinks] notifyMerchantPaymentLinkPaid failed for ${paymentLinkPaymentId}`,
      err
    );
  }
}