import { prisma } from "@/lib/db/prisma";
import { LegalDocumentType } from "@/app/generated/prisma/client";

export async function getActiveLegalDocument(
  type: LegalDocumentType = "TERMS_OF_SERVICE"
) {
  return prisma.legalDocument.findFirst({
    where: { documentType: type, isActive: true },
    orderBy: { publishedAt: "desc" },
  });
}

/** Record acceptance (call from signup / settings / force-accept modal) */
export async function recordLegalConsent(params: {
  userId: string;
  documentId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return prisma.userLegalConsent.create({
    data: {
      userId: params.userId,
      documentId: params.documentId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}