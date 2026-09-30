/**
 * Backends for the rate limiter: per-instance memory, or Upstash Redis shared
 * by every instance. Both sit behind one `consume(key, rules, now)` interface.
 *
 * Redis is used only when its REST env vars are present, so local dev, tests
 * and e2e run on memory alone. If Redis errors or is slow, that request falls
 * back to the in-memory limiter (fail open to the per-instance limit, never
 * closed).
 */
import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { RateLimiter, RateLimitDecision, RateLimitRule } from "./rateLimit";

export interface RateLimitStore {
  consume(key: string, rules: ReadonlyArray<RateLimitRule>, now?: number): Promise<RateLimitDecision>;
}

/** The one Redis operation used: EVAL with KEYS and ARGV. */
export type RedisEval = (script: string, keys: string[], args: unknown[]) => Promise<unknown>;

/**
 * Sliding window over sorted sets, checked and recorded in one script.
 *
 * KEYS[i] is rule i's bucket. ARGV is [now, nonce, window1, max1, window2, max2, ...].
 * Redis runs a script to completion before any other command, so the check of
 * every bucket and the recording of the hit cannot interleave with another
 * request: two instances can never both take the last slot.
 *
 * Pass 1 trims entries at or before now - window (the same "now - t < window"
 * boundary as the in-memory limiter) and counts. If any bucket is full it
 * returns [0, ruleIndex, oldestScore] before writing anything, so a rejected
 * request does not extend its own lockout. Pass 2 runs only when every rule
 * passed: it adds one hit per bucket (member = now:nonce:index, unique) and
 * refreshes the bucket's TTL to its window so idle buckets expire on their own.
 * Returns [1] on success.
 */
export const RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local nonce = ARGV[2]
for i = 1, #KEYS do
  local window = tonumber(ARGV[1 + 2 * i])
  local max = tonumber(ARGV[2 + 2 * i])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  if redis.call('ZCARD', KEYS[i]) >= max then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    return {0, i - 1, oldest[2]}
  end
end
for i = 1, #KEYS do
  local window = tonumber(ARGV[1 + 2 * i])
  redis.call('ZADD', KEYS[i], now, now .. ':' .. nonce .. ':' .. i)
  redis.call('PEXPIRE', KEYS[i], window)
end
return {1}
`;

export class MemoryStore implements RateLimitStore {
  constructor(private readonly limiter: RateLimiter) {}

  async consume(key: string, rules: ReadonlyArray<RateLimitRule>): Promise<RateLimitDecision> {
    return this.limiter.consume(key, rules);
  }
}

export class RedisStore implements RateLimitStore {
  constructor(
    private readonly evalScript: RedisEval,
    private readonly options: { random?: () => string } = {},
  ) {}

  async consume(key: string, rules: ReadonlyArray<RateLimitRule>, now: number = Date.now()): Promise<RateLimitDecision> {
    // Hash the client key so no raw addresses are stored in Redis.
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
    const keys = rules.map((rule) => `rl:${rule.name}:${digest}`);
    const args: unknown[] = [now, (this.options.random ?? randomUUID)()];
    for (const rule of rules) args.push(rule.windowMs, rule.max);

    const result = await this.evalScript(RATE_LIMIT_SCRIPT, keys, args);
    if (!Array.isArray(result)) throw new Error("Unexpected rate limit script reply");
    if (Number(result[0]) === 1) return { ok: true };
    const rule = rules[Number(result[1])];
    const oldest = Number(result[2]);
    if (!rule || !Number.isFinite(oldest)) throw new Error("Unexpected rate limit script reply");
    const retryAfterMs = oldest + rule.windowMs - now;
    return { ok: false, rule: rule.name, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
}

const REDIS_TIMEOUT_MS = 500;
const LOG_INTERVAL_MS = 60_000;

/** Tries the primary store; on an error or a timeout, uses the fallback for that request. */
export class FallbackStore implements RateLimitStore {
  private lastLogged = -Infinity;
  private readonly timeoutMs: number;
  private readonly log: (message: string) => void;
  private readonly clock: () => number;

  constructor(
    private readonly primary: RateLimitStore,
    private readonly fallback: RateLimitStore,
    options: { timeoutMs?: number; log?: (message: string) => void; clock?: () => number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? REDIS_TIMEOUT_MS;
    this.log = options.log ?? ((message) => console.warn(message));
    this.clock = options.clock ?? Date.now;
  }

  async consume(key: string, rules: ReadonlyArray<RateLimitRule>, now?: number): Promise<RateLimitDecision> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      });
      return await Promise.race([this.primary.consume(key, rules, now), timeout]);
    } catch (error) {
      const at = this.clock();
      if (at - this.lastLogged >= LOG_INTERVAL_MS) {
        this.lastLogged = at;
        const reason = error instanceof Error ? error.message : String(error);
        this.log(`Rate limit store unavailable, using per-instance limits: ${reason}`);
      }
      return this.fallback.consume(key, rules, now);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Redis when its REST env vars are set (either integration naming), else memory. */
export function storeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  limiter: RateLimiter,
): RateLimitStore {
  const memory = new MemoryStore(limiter);
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return memory;
  const redis = new Redis({ url, token });
  const evalScript: RedisEval = (script, keys, args) => redis.eval(script, keys, args);
  return new FallbackStore(new RedisStore(evalScript), memory);
}
