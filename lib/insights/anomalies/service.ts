// lib/insights/anomalies/service.ts
//
// Read/dismiss operations for SpendingAnomaly. Detection itself (writing
// rows) lives entirely in lib/insights/anomalies/detect.ts — this module
// never creates or recomputes an anomaly, only surfaces and dismisses
// existing ones.

import { prisma } from "@/lib/db/prisma";
import { toDecimalString } from "@/lib/circle/amount";
import type { AnomalyStatus, SpendingAnomaly } from "@/app/generated/prisma/client";

export class AnomalyNotFoundError extends Error {
  constructor() {
    super("Anomaly not found");
    this.name = "AnomalyNotFoundError";
  }
}

export async function listAnomalies(
  orgId: string,
  options: { status?: AnomalyStatus } = {}
): Promise<SpendingAnomaly[]> {
  return prisma.spendingAnomaly.findMany({
    where: { orgId, ...(options.status ? { status: options.status } : {}) },
    include: { onchainTransaction: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Not blocking, not an accusation — dismiss just clears it from the "worth a second look" list. Never resurrected by a later detection sweep re-run (see detect.ts#upsertAnomaly). */
export async function dismissAnomaly(orgId: string, anomalyId: string): Promise<SpendingAnomaly> {
  const anomaly = await prisma.spendingAnomaly.findFirst({ where: { id: anomalyId, orgId } });
  if (!anomaly) throw new AnomalyNotFoundError();

  return prisma.spendingAnomaly.update({
    where: { id: anomalyId },
    data: { status: "DISMISSED", dismissedAt: new Date() },
  });
}

/** Serializes bigint fields for API responses. */
export function serializeAnomaly(anomaly: SpendingAnomaly) {
  return {
    ...anomaly,
    transactionAmount: toDecimalString(anomaly.transactionAmount),
    comparisonAmount: anomaly.comparisonAmount !== null ? toDecimalString(anomaly.comparisonAmount) : null,
  };
}