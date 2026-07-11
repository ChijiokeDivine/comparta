// lib/http/clientIp.ts
//
// Best-effort client IP extraction for rate limiting. Behind Vercel/most
// proxies, x-forwarded-for carries a comma-separated chain of hops with
// the original client first. Falls back to a constant so rate limiting
// still functions (conservatively, shared across all unknown-IP callers)
// rather than throwing when headers are absent, e.g. in local dev.

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}