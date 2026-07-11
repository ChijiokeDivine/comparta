// lib/rateLimit.ts
//
// Minimal fixed-window rate limiter backed by Redis (reuses the same
// connection jobs/queue.ts already maintains). Good enough to blunt
// automated username-squatting attempts without pulling in a dedicated
// rate-limiting service — one INCR + one conditional EXPIRE per check.

import { getRedisClient } from "@/jobs/queue";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

/**
 * @param key         Uniquely identifies what's being limited, e.g.
 *                    `username-claim:${ip}`.
 * @param limit       Max allowed attempts within the window.
 * @param windowSeconds Fixed window length in seconds.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const redisKey = `ratelimit:${key}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    // First hit in this window — set expiry. A race here (two first-hits
    // both calling EXPIRE) is harmless since both set the same TTL.
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
}