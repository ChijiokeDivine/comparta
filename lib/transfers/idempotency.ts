// lib/transfers/idempotency.ts
//
// Generic API-level idempotency, backed by the IdempotencyKey table. This
// guards against double-submission from a slow/retrying UI at the HTTP
// layer — distinct from (and in addition to) the Circle-level
// idempotencyKey on OnchainTransaction, which guards the actual funds
// movement even if this layer were somehow bypassed.
//
// Usage pattern (see app/api/transfers/send/route.ts):
//   const existing = await checkIdempotency(orgId, endpoint, key, requestHash);
//   if (existing) return existing.responseBody; // replay, don't re-execute
//   ... do the work ...
//   await completeIdempotency(orgId, endpoint, key, responseBody, status);

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

const DEFAULT_TTL_HOURS = 24;

export class DuplicateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRequestError";
  }
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export interface IdempotentReplay {
  responseBody: unknown;
  responseStatus: number;
}

/**
 * Checks for a prior request under this (orgId, endpoint, key).
 *
 * - No prior row -> reserves a PENDING row and returns null (caller
 *   should proceed with the actual work).
 * - Prior row is COMPLETED -> returns the stored response for replay.
 * - Prior row is PENDING (a concurrent request with the same key is
 *   in flight right now) -> throws DuplicateRequestError; this is the
 *   "double-submission from a slow UI" case firing within the same
 *   instant, before either request has finished.
 * - Prior row is FAILED -> treated like "no prior row": reserved fresh
 *   so a genuinely failed attempt can be retried with the same key.
 *
 * The reservation itself relies on the @@unique([orgId, endpoint, key])
 * constraint to be race-safe across concurrent requests, the same way
 * the username claim route relies on its unique constraint.
 */
export async function checkAndReserveIdempotencyKey(
  orgId: string,
  endpoint: string,
  key: string,
  requestHash: string,
  ttlHours: number = DEFAULT_TTL_HOURS
): Promise<IdempotentReplay | null> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { orgId_endpoint_key: { orgId, endpoint, key } },
  });

  if (existing) {
    if (existing.expiresAt < new Date()) {
      // Expired — treat as absent, delete and fall through to re-reserve.
      await prisma.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => {});
    } else if (existing.status === "COMPLETED") {
      if (existing.requestHash !== requestHash) {
        throw new DuplicateRequestError(
          "This idempotency key was already used with a different request payload."
        );
      }
      return {
        responseBody: existing.responseBody,
        responseStatus: existing.responseStatus ?? 200,
      };
    } else if (existing.status === "PENDING") {
      throw new DuplicateRequestError(
        "A request with this idempotency key is already being processed."
      );
    }
    // status === "FAILED": fall through and re-reserve below.
  }

  try {
    await prisma.idempotencyKey.upsert({
      where: { orgId_endpoint_key: { orgId, endpoint, key } },
      create: {
        orgId,
        endpoint,
        key,
        requestHash,
        status: "PENDING",
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      },
      update: {
        requestHash,
        status: "PENDING",
        responseBody: undefined,
        responseStatus: undefined,
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateRequestError(
        "A request with this idempotency key is already being processed."
      );
    }
    throw err;
  }

  return null;
}

export async function completeIdempotencyKey(
  orgId: string,
  endpoint: string,
  key: string,
  responseBody: unknown,
  responseStatus: number
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { orgId_endpoint_key: { orgId, endpoint, key } },
    data: { status: "COMPLETED", responseBody: responseBody as never, responseStatus },
  });
}

export async function failIdempotencyKey(orgId: string, endpoint: string, key: string): Promise<void> {
  await prisma.idempotencyKey
    .update({
      where: { orgId_endpoint_key: { orgId, endpoint, key } },
      data: { status: "FAILED" },
    })
    .catch(() => {
      // Best-effort — if this fails there's nothing more useful to do
      // than let the key expire naturally via TTL.
    });
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}