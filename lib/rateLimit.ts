// lib/rateLimit.ts
//
// Minimal fixed-window rate limiter.
//
// Primary storage: Redis (reuses the same connection jobs/queue.ts already
// maintains) when available and permissioned — one INCR + one conditional
// EXPIRE per check.
//
// Fallback storage: in-process Map. Used automatically when Redis is
// unreachable OR when the Redis user lacks permission for the commands we
// need (the classic Upstash free-tier "NOPERM this user has no permissions
// to run the 'incr' command" error). Acceptable for non-critical,
// best-effort anti-abuse like username-claim squatting defense. Caveat:
// per-process counters on multi-instance deployments mean a squatter can
// do (limit * instance_count) attempts total instead of (limit). Upgrade
// to a fully-permissioned Redis when that trade-off stops being fine.

import { getRawRedisClient } from "@/jobs/queue";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

type InMemoryEntry = { count: number; windowStartMs: number };

const globalForRateLimit = globalThis as unknown as {
  rateLimitInMemory: Map<string, InMemoryEntry> | undefined;
  rateLimitRedisWarned: boolean | undefined;
};

function getInMemoryMap(): Map<string, InMemoryEntry> {
  if (!globalForRateLimit.rateLimitInMemory) {
    globalForRateLimit.rateLimitInMemory = new Map();
  }
  return globalForRateLimit.rateLimitInMemory;
}

function nowMs(): number {
  return Date.now();
}

function logRedisDegradedOnce(reason: string): void {
  if (globalForRateLimit.rateLimitRedisWarned) return;
  globalForRateLimit.rateLimitRedisWarned = true;
  console.warn(
    `[rateLimit] Redis rate limiting unavailable (${reason}). ` +
      `Falling back to in-process counters. ` +
      `This means rate limits are PER INSTANCE, not globally shared. ` +
      `If this is Upstash free tier, upgrade to a paid tier or switch to a ` +
      `Redis provider that allows +@string/INCR/EXPIRE commands for the ` +
      `configured REDIS_URL user.`
  );
}

function isNonBlockingRedisError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("NOPERM")) return true;
  if (msg.includes("no permissions")) return true;
  if (msg.includes("Connection is closed")) return true;
  if (msg.includes("ECONNREFUSED")) return true;
  if (msg.includes("ETIMEDOUT")) return true;
  if (msg.includes("MaxRetriesPerRequest")) return true;
  if (msg.includes("ERR unknown command")) return true;
  return false;
}

/**
 * @param key           Uniquely identifies what's being limited, e.g.
 *                      `username-claim:${ip}`.
 * @param limit         Max allowed attempts within the window.
 * @param windowSeconds Fixed window length in seconds.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const redis = getRawRedisClient();
    const redisKey = `ratelimit:${key}`;

    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    const ttl = await redis.ttl(redisKey);
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      limit,
      resetSeconds,
    };
  } catch (err) {
    if (!isNonBlockingRedisError(err)) throw err;

    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    logRedisDegradedOnce(msg);
  }

  return checkRateLimitInMemory(key, limit, windowSeconds);
}

function checkRateLimitInMemory(
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const map = getInMemoryMap();
  const now = nowMs();
  const windowMs = windowSeconds * 1000;

  const existing = map.get(key);
  const inWindow = existing && now - existing.windowStartMs < windowMs;
  let count: number;
  let resetSeconds: number;

  if (inWindow && existing) {
    count = existing.count + 1;
    existing.count = count;
    const elapsedMs = now - existing.windowStartMs;
    resetSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
  } else {
    count = 1;
    map.set(key, { count, windowStartMs: now });
    resetSeconds = windowSeconds;
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    limit,
    resetSeconds,
  };
}
