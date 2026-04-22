import { NextRequest, NextResponse } from "next/server";

/**
 * Public API access control.
 *
 * Two modes:
 *  1. **Unauthenticated** — 60 req/min per IP on `/api/*` public routes
 *  2. **API key** — 600 req/min per key on `/api/*` public routes
 *
 * Admin routes (`/api/admin/*`) and the cron route (`/api/cron/*`) keep
 * their existing bearer-token auth (CRON_SECRET) — untouched by this middleware.
 *
 * Page routes pass through unrestricted.
 */

// Simple in-memory token bucket per identity (IP or API key).
// For real scale, swap for Upstash Redis or Vercel KV. Good enough for now.
type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function take(id: string, capacity: number): boolean {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: capacity, lastRefill: now };
  const elapsed = now - b.lastRefill;
  if (elapsed >= WINDOW_MS) {
    b.tokens = capacity;
    b.lastRefill = now;
  }
  if (b.tokens <= 0) {
    buckets.set(id, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(id, b);
  return true;
}

function validApiKey(key: string | null): boolean {
  if (!key) return false;
  const keys = (process.env.API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return keys.includes(key);
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Admin + cron routes handle their own auth
  if (path.startsWith("/api/admin/") || path.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Only rate-limit /api/* — pages pass through
  if (!path.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Determine identity + capacity
  const apiKey = req.headers.get("x-api-key");
  const isAuthed = validApiKey(apiKey);
  const identity = isAuthed ? `key:${apiKey}` : `ip:${getClientIp(req)}`;
  const capacity = isAuthed ? 600 : 60;

  const allowed = take(identity, capacity);
  const bucket = buckets.get(identity);
  const remaining = bucket?.tokens ?? 0;
  const resetMs = bucket ? bucket.lastRefill + WINDOW_MS - Date.now() : WINDOW_MS;

  if (!allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        limit: capacity,
        windowSeconds: 60,
        authenticated: isAuthed,
        hint: isAuthed
          ? "You have hit the authenticated rate limit."
          : "Attach an X-API-Key header to get 10x higher limits. Contact hello@phaselabs.io for a key.",
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(capacity),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(resetMs / 1000)),
          "Retry-After": String(Math.ceil(resetMs / 1000)),
        },
      }
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(capacity));
  res.headers.set("X-RateLimit-Remaining", String(remaining));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
  res.headers.set("X-Authenticated", isAuthed ? "true" : "false");
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
