// lib/paymentLinks/serialize.ts
import type { PaymentLink } from "@/app/generated/prisma/client";
import { toDecimalString } from "@/lib/circle/amount";

export function serializePaymentLink(link: PaymentLink) {
  return {
    id: link.id,
    orgId: link.orgId,
    slug: link.slug,
    type: link.type,
    // BigInt → decimal string (null stays null)
    amount: link.amount !== null ? toDecimalString(link.amount) : null,
    description: link.description,
    status: link.status,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    maxUses: link.maxUses,
    useCount: link.useCount,
    // Denormalized counters — also BigInt
    payments: link.payments,
    collected: toDecimalString(link.collected),
    received: toDecimalString(link.received),
    receivingLedgerAccountId: link.receivingLedgerAccountId,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}