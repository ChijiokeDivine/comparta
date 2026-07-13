// lib/savings/yieldRate.ts
//
// Short-TTL cache in front of Circle's USYC NAV / yield-rate endpoints
// (lib/circle/usyc.ts). Backed by the same Redis connection jobs/queue.ts
// and lib/rateLimit.ts already maintain, so the cache is shared across
// every Next.js server instance — one Circle API call serves every
// request within the TTL window, not just requests hitting the same
// process.
//
// NEVER call lib/circle/usyc.ts's getUsycNav / getUsycYieldRate directly
// from a request handler — always go through here, or a busy dashboard
// hits Circle's API on every single page load (the exact problem this
// module exists to prevent, per the product requirement).

import { getRawRedisClient } from "@/jobs/queue";
import { getUsycNav, getUsycYieldRate, type UsycNav, type UsycYieldRate } from "@/lib/circle/usyc";

const NAV_CACHE_KEY = "usyc:nav";
const YIELD_RATE_CACHE_KEY = "usyc:yield-rate";

// Short enough that displayed figures never drift far from reality, long
// enough that a busy dashboard doesn't hammer Circle's API. Tune per your
// own latency/freshness tradeoff — nothing else in this module needs to
// change if you do.
const CACHE_TTL_SECONDS = 300; // 5 minutes

interface CachedUsycNav {
  navPerShare: string;
  asOf: string; // ISO string — Date doesn't survive JSON round-trip
}

interface CachedUsycYieldRate {
  apyBps: number;
  asOf: string;
}

/** Cached current NAV (USDC per whole USYC token). Refetches from Circle at most once per CACHE_TTL_SECONDS, process-wide (shared via Redis). */
export async function getCachedUsycNav(): Promise<UsycNav> {
  const redis = getRawRedisClient();

  const cached = await redis.get(NAV_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as CachedUsycNav;
    return { navPerShare: parsed.navPerShare, asOf: new Date(parsed.asOf) };
  }

  const nav = await getUsycNav();
  const toCache: CachedUsycNav = { navPerShare: nav.navPerShare, asOf: nav.asOf.toISOString() };
  await redis.set(NAV_CACHE_KEY, JSON.stringify(toCache), "EX", CACHE_TTL_SECONDS);
  return nav;
}

/** Cached current published USYC yield rate (APY, basis points). Same caching posture as getCachedUsycNav. */
export async function getCachedUsycYieldRate(): Promise<UsycYieldRate> {
  const redis = getRawRedisClient();

  const cached = await redis.get(YIELD_RATE_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as CachedUsycYieldRate;
    return { apyBps: parsed.apyBps, asOf: new Date(parsed.asOf) };
  }

  const rate = await getUsycYieldRate();
  const toCache: CachedUsycYieldRate = { apyBps: rate.apyBps, asOf: rate.asOf.toISOString() };
  await redis.set(YIELD_RATE_CACHE_KEY, JSON.stringify(toCache), "EX", CACHE_TTL_SECONDS);
  return rate;
}

/** Force-invalidates both caches — for tests, or an admin "refresh now" action if you ever want one. Never call this from a normal request path. */
export async function invalidateUsycRateCache(): Promise<void> {
  const redis = getRawRedisClient();
  await redis.del(NAV_CACHE_KEY, YIELD_RATE_CACHE_KEY);
}