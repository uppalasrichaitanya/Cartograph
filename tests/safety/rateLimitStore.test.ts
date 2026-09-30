import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FallbackStore,
  MemoryStore,
  RATE_LIMIT_SCRIPT,
  RedisStore,
  storeFromEnv,
  type RedisEval,
} from "../../lib/safety/rateLimitStore";
import { RateLimiter } from "../../lib/safety/rateLimit";

const rule = { name: "test", windowMs: 60_000, max: 2 };
const hash = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

type Call = { script: string; keys: string[]; args: unknown[] };

/** A JS re-implementation of the Lua script's semantics over a Map of sorted sets. */
function fakeRedis(calls: Call[] = []): RedisEval {
  const sets = new Map<string, Array<{ score: number; member: string }>>();
  return async (script, keys, args) => {
    calls.push({ script, keys, args });
    const now = Number(args[0]);
    const nonce = String(args[1]);
    const limits = keys.map((_, i) => ({ window: Number(args[2 + 2 * i]), max: Number(args[3 + 2 * i]) }));
    keys.forEach((key, i) => {
      sets.set(key, (sets.get(key) ?? []).filter((entry) => entry.score > now - limits[i].window));
    });
    for (let i = 0; i < keys.length; i += 1) {
      const set = sets.get(keys[i])!;
      if (set.length >= limits[i].max) {
        const oldest = Math.min(...set.map((entry) => entry.score));
        return [0, i, oldest];
      }
    }
    keys.forEach((key, i) => sets.get(key)!.push({ score: now, member: `${now}:${nonce}:${i}` }));
    return [1];
  };
}

test("RedisStore sends the script with hashed KEYS and the time and limits as ARGV", async () => {
  const calls: Call[] = [];
  const store = new RedisStore(fakeRedis(calls), { random: () => "abc" });
  assert.equal((await store.consume("203.0.113.9", [rule], 1_000)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, RATE_LIMIT_SCRIPT);
  assert.deepEqual(calls[0].keys, [`rl:test:${hash("203.0.113.9")}`]);
  assert.ok(!calls[0].keys[0].includes("203.0.113.9"));
  assert.deepEqual(calls[0].args, [1_000, "abc", 60_000, 2]);
});

test("RedisStore allows up to max, then reports the rule and when to retry", async () => {
  const store = new RedisStore(fakeRedis());
  assert.equal((await store.consume("a", [rule], 0)).ok, true);
  assert.equal((await store.consume("a", [rule], 10_000)).ok, true);
  const limited = await store.consume("a", [rule], 20_000);
  assert.deepEqual(limited, { ok: false, rule: "test", retryAfterSeconds: 40 });
  assert.equal((await store.consume("b", [rule], 20_000)).ok, true);
  assert.equal((await store.consume("a", [rule], 60_001)).ok, true);
});

test("RedisStore: a rejected request records nothing, and the failing rule is named", async () => {
  const store = new RedisStore(fakeRedis());
  const rules = [{ name: "fast", windowMs: 1_000, max: 5 }, { name: "slow", windowMs: 60_000, max: 1 }];
  assert.equal((await store.consume("a", rules, 0)).ok, true);
  for (let t = 1; t <= 5; t += 1) {
    const limited = await store.consume("a", rules, t * 100);
    assert.deepEqual(limited, { ok: false, rule: "slow", retryAfterSeconds: 60 });
  }
  assert.equal((await store.consume("a", rules, 60_000)).ok, true);
});

test("FallbackStore uses the in-memory limiter when Redis errors", async () => {
  const logs: string[] = [];
  const failing = new RedisStore(async () => {
    throw new Error("boom");
  });
  const store = new FallbackStore(failing, new MemoryStore(new RateLimiter(() => 0)), { log: (m) => logs.push(m) });
  assert.equal((await store.consume("a", [rule], 0)).ok, true);
  assert.equal((await store.consume("a", [rule], 0)).ok, true);
  assert.equal((await store.consume("a", [rule], 0)).ok, false);
  assert.equal(logs.length, 1);
});

test("FallbackStore uses the in-memory limiter when Redis takes longer than the timeout", async () => {
  const slow = new RedisStore(() => new Promise(() => {}));
  const store = new FallbackStore(slow, new MemoryStore(new RateLimiter(() => 0)), { timeoutMs: 20, log: () => {} });
  assert.equal((await store.consume("a", [rule], 0)).ok, true);
});

test("FallbackStore logs at most once a minute", async () => {
  let clock = 0;
  const logs: string[] = [];
  const failing = new RedisStore(async () => {
    throw new Error("boom");
  });
  const store = new FallbackStore(failing, new MemoryStore(new RateLimiter(() => 0)), {
    log: (m) => logs.push(m),
    clock: () => clock,
  });
  await store.consume("a", [{ ...rule, max: 100 }], 0);
  await store.consume("a", [{ ...rule, max: 100 }], 0);
  clock = 61_000;
  await store.consume("a", [{ ...rule, max: 100 }], 0);
  assert.equal(logs.length, 2);
});

test("storeFromEnv picks memory without Redis env, and Redis with either naming", () => {
  const limiter = new RateLimiter();
  assert.ok(storeFromEnv({}, limiter) instanceof MemoryStore);
  assert.ok(storeFromEnv({ KV_REST_API_URL: "https://x" }, limiter) instanceof MemoryStore);
  assert.ok(storeFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }, limiter) instanceof FallbackStore);
  assert.ok(
    storeFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }, limiter) instanceof FallbackStore,
  );
});
