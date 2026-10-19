/**
 * A per-IP request budget for the public API routes that spend RPC calls (/api/share, /api/admin). Fixed one-minute
 * windows in this instance's memory: it stops one client hammering one instance, which is what drains the RPC quota.
 */
import "server-only";

// ponytail: per instance; move to Vercel Firewall or a shared store (Upstash) if abuse spreads across instances
const windows = new Map<string, { start: number; count: number }>();
const WINDOW_MS = 60_000;

/** The caller's IP as Vercel reports it. */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/** True while `key` has made at most `limit` requests in the current minute. */
export function allow(key: string, limit: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    if (windows.size > 10_000) windows.clear();
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}
