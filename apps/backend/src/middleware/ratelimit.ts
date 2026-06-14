import type { Context, MiddlewareHandler } from "hono";
import { clientIp } from "../lib/request.ts";
import type { AppEnv } from "../types.ts";

// Rate limiting. A fixed-window counter held in process memory: simple,
// dependency-free, and right for a single instance.

interface Bucket {
  count: number;
  resetAt: number; // epoch ms when the window rolls over
}

export interface RateLimitOptions {
  /** Distinct namespace so different limiters don't share buckets. */
  name: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Derives the bucket key from the request (identity to throttle on). */
  key: (c: Context<AppEnv>) => string;
}

// One map per limiter instance. A lazy sweep on access drops expired buckets so
// memory tracks active clients rather than all-time clients.
function makeStore() {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;
  return {
    hit(key: string, _limit: number, windowMs: number, now: number) {
      if (now - lastSweep > windowMs) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        lastSweep = now;
      }
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      b.count++;
      return { count: b.count, resetAt: b.resetAt };
    },
  };
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const store = makeStore();
  return async (c, next) => {
    const now = Date.now();
    const id = `${opts.name}:${opts.key(c)}`;
    const { count, resetAt } = store.hit(id, opts.limit, opts.windowMs, now);

    const remaining = Math.max(0, opts.limit - count);
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: `rate limit exceeded — retry in ${retryAfter}s` },
        429,
      );
    }
    return next();
  };
}

// --- Key derivations ---------------------------------------------------------

/** Throttle by IP — for the unauthenticated public endpoints. */
export const byIp = (c: Context<AppEnv>): string => clientIp(c);
