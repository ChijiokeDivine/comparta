// lib/paymentLinks/serialize.ts
//
// PaymentLink.amount / PaymentLinkPayment.amountExpected/amountPaid are
// bigint — same JSON-serialization problem as Invoice's money fields (see
// lib/invoices/serialize.ts). Every API route returning one of these must
// go through here first.

import { toDecimalString } from "@/lib/circle/amount";
import type { PaymentLink, PaymentLinkPayment } from "@/app/generated/prisma/client";

export function serializePaymentLink(link: PaymentLink) {
  return {
    ...link,
    amount: link.amount !== null ? toDecimalString(link.amount) : null,
  };
}

export function serializePaymentLinkPayment(payment: PaymentLinkPayment) {
  return {
    ...payment,
    amountExpected: toDecimalString(payment.amountExpected),
    amountPaid: payment.amountPaid !== null ? toDecimalString(payment.amountPaid) : null,
  };
}