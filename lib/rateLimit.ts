/**
 * Per-IP token bucket for the JSON API.
 *
 * Dependency-free and in-process: every instance keeps its own buckets, which
 * is the right granularity here because each Dokploy instance runs its own app
 * *and* its own Postgres, so the resource a limit protects is per-instance too.
 *
 * The shape is a classic token bucket — `BURST` tokens in the bucket, refilled
 * at `RATE` per second — so a page that fires a handful of requests at once
 * (search + property + map points) is never punished, while a scraper walking
 * the roll at full speed is held to a sustained rate.
 *
 * Applied by the route handlers rather than by a `middleware.ts`, matching how
 * the routes already share `lib/http.ts`. Middleware would run on every page
 * and every static asset to guard six handlers, and it would run them inside
 * Next's edge sandbox, where "in-process" is a claim rather than a fact. The
 * cost is that a *new* API route has to opt in — hence the exemptions being
 * listed on `rateLimit()` below rather than left implicit.
 */

/** Sustained requests per second per IP. `0` disables the limiter entirely. */
const RATE = Number(process.env.RATE_LIMIT_RPS ?? 30);
/** Bucket size — how many requests a client may fire back-to-back. */
const BURST = Number(process.env.RATE_LIMIT_BURST ?? 60);

/** Hard ceiling on tracked clients; the least recently seen are evicted. */
const MAX_CLIENTS = 20_000;
/** How often the sweep runs, at most, and how long an idle bucket survives. */
const SWEEP_INTERVAL_MS = 60_000;
const IDLE_TTL_MS = 300_000;

type Bucket = {
  /** Tokens left, fractional; refilled lazily on read. */
  tokens: number;
  /** Timestamp of the last refill, ms. */
  last: number;
};

/**
 * Insertion order doubles as recency: a bucket is deleted and re-set on every
 * hit, so the oldest entries sit at the front and `keys().next()` is the LRU
 * victim. That keeps memory bounded without a second data structure.
 */
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** Test seam, and useful after changing the limits in a long-lived process. */
export function resetRateLimit(): void {
  buckets.clear();
  lastSweep = Date.now();
}

/**
 * The client's address. Behind Traefik the socket address is the proxy, so the
 * first hop of `X-Forwarded-For` is the real client; Traefik appends to (and
 * does not trust) whatever the client sent, and the app is never exposed
 * directly, so the first hop is the value to key on. Requests that arrive with
 * no proxy headers at all (local dev, container health checks) share one key.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Drop buckets that are full (nothing owed) and have not been seen in a while. */
function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (b.tokens >= BURST && now - b.last > IDLE_TTL_MS) buckets.delete(key);
  }
  // Whatever the sweep left, keep the map under its ceiling by dropping the
  // least recently seen. Evicting is always safe: a missing bucket is a full one.
  while (buckets.size > MAX_CLIENTS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** Whole seconds until the next token, for `Retry-After`. */
  retryAfter: number;
  remaining: number;
};

/** Take one token for `key`, refilling first. Pure bookkeeping, no HTTP. */
export function take(key: string, now = Date.now()): RateLimitResult {
  if (now - lastSweep > SWEEP_INTERVAL_MS) {
    lastSweep = now;
    sweep(now);
  }

  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: BURST, last: now };
  if (existing) {
    bucket.tokens = Math.min(BURST, bucket.tokens + ((now - bucket.last) / 1000) * RATE);
    bucket.last = now;
    // Re-insert so insertion order stays recency order.
    buckets.delete(key);
  }
  buckets.set(key, bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfter: 0, remaining: Math.floor(bucket.tokens) };
  }
  const seconds = RATE > 0 ? (1 - bucket.tokens) / RATE : 1;
  return { allowed: false, retryAfter: Math.max(1, Math.ceil(seconds)), remaining: 0 };
}

/**
 * Guard for an API route: returns a ready-made 429 when the caller is over its
 * budget, or `null` to carry on. Call it as the first statement of a handler.
 *
 *   const limited = rateLimit(req);
 *   if (limited) return limited;
 *
 * Deliberately *not* applied to `/api/map/overview` (one hard-cached fetch per
 * session, served from a process-local buffer) or `/api/health`.
 */
export function rateLimit(req: Request): Response | null {
  if (!(RATE > 0)) return null;
  const result = take(clientIp(req));
  if (result.allowed) return null;

  return new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfter),
      'X-RateLimit-Limit': String(RATE),
      'X-RateLimit-Remaining': '0',
      // A 429 is about this caller at this moment; it must never be stored.
      'Cache-Control': 'no-store',
    },
  });
}
