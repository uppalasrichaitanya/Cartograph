/**
 * In-memory sliding-window rate limiting for API routes.
 *
 * Limits are kept per server instance. On Vercel Fluid Compute an instance is
 * reused across many requests, so this stops casual abuse and protects
 * free-tier AI quotas, but it is not a global guarantee: separate instances
 * keep separate counters. A shared store (for example Upstash Redis) is the
 * upgrade path when that matters.
 */

export type RateLimitRule = Readonly<{
  /** Stable name, used in keys and error messages. */
  name: string;
  windowMs: number;
  max: number;
}>;

export type RateLimitDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; rule: string; retryAfterSeconds: number }>;

const MAX_TRACKED_KEYS = 10_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Checks every rule for `key` and records a hit only when all rules pass,
   * so a rejected request does not extend its own lockout.
   */
  consume(key: string, rules: ReadonlyArray<RateLimitRule>): RateLimitDecision {
    const now = this.now();
    for (const rule of rules) {
      const recent = this.recent(`${rule.name}:${key}`, rule.windowMs, now);
      if (recent.length >= rule.max) {
        const retryAfterMs = recent[0] + rule.windowMs - now;
        return { ok: false, rule: rule.name, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
    }
    for (const rule of rules) this.recent(`${rule.name}:${key}`, rule.windowMs, now).push(now);
    this.evictIfFull();
    return { ok: true };
  }

  private recent(bucket: string, windowMs: number, now: number): number[] {
    const existing = this.hits.get(bucket) ?? [];
    const recent = existing.filter((time) => now - time < windowMs);
    this.hits.set(bucket, recent);
    return recent;
  }

  private evictIfFull(): void {
    if (this.hits.size <= MAX_TRACKED_KEYS) return;
    // Map iteration order is insertion order; drop the oldest buckets first.
    for (const bucket of this.hits.keys()) {
      this.hits.delete(bucket);
      if (this.hits.size <= MAX_TRACKED_KEYS / 2) break;
    }
  }
}

/** Best-effort client identity from standard proxy headers. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-client";
}

const MINUTE = 60_000;

/**
 * Route budgets. The AI limits sit below the free tiers of the configured
 * providers (roughly 10-30 requests per minute each), with a per-instance
 * global cap so one busy page cannot exhaust a shared key.
 */
export const RATE_LIMITS = {
  aiPerClient: [
    { name: "ai-client-minute", windowMs: MINUTE, max: 6 },
    { name: "ai-client-hour", windowMs: 60 * MINUTE, max: 40 },
  ],
  aiGlobal: [{ name: "ai-global-minute", windowMs: MINUTE, max: 20 }],
  analyze: [
    { name: "analyze-10min", windowMs: 10 * MINUTE, max: 6 },
    { name: "analyze-day", windowMs: 24 * 60 * MINUTE, max: 40 },
  ],
  diagram: [
    { name: "diagram-minute", windowMs: MINUTE, max: 30 },
    { name: "diagram-day", windowMs: 24 * 60 * MINUTE, max: 300 },
  ],
  upload: [{ name: "upload-10min", windowMs: 10 * MINUTE, max: 10 }],
} as const satisfies Record<string, ReadonlyArray<RateLimitRule>>;

export const sharedRateLimiter = new RateLimiter();

const GLOBAL_KEY = "*";

/**
 * Applies the per-client rules and, optionally, instance-wide rules.
 * Returns a 429 response when limited, or null to continue.
 */
export function enforceRateLimit(
  request: Request,
  rules: ReadonlyArray<RateLimitRule>,
  globalRules: ReadonlyArray<RateLimitRule> = [],
  limiter: RateLimiter = sharedRateLimiter,
): Response | null {
  const decision = limiter.consume(clientKey(request), rules);
  const limited = decision.ok && globalRules.length ? limiter.consume(GLOBAL_KEY, globalRules) : decision;
  if (limited.ok) return null;
  const busy = limited.rule.includes("global");
  return Response.json(
    {
      error: busy
        ? `Cartograph is handling a lot of requests right now. Try again in ${limited.retryAfterSeconds}s.`
        : `Too many requests. Try again in ${limited.retryAfterSeconds}s.`,
      retryAfterSeconds: limited.retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
  );
}
