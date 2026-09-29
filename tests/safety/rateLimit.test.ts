import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, clientKey, enforceRateLimit } from "../../lib/safety/rateLimit";

const rule = { name: "test", windowMs: 60_000, max: 2 };

test("sliding window allows up to max hits, then reports when to retry", () => {
  let now = 0;
  const limiter = new RateLimiter(() => now);
  assert.equal(limiter.consume("a", [rule]).ok, true);
  now = 10_000;
  assert.equal(limiter.consume("a", [rule]).ok, true);
  const limited = limiter.consume("a", [rule]);
  assert.equal(limited.ok, false);
  assert.equal(!limited.ok && limited.retryAfterSeconds, 50);
  // Other clients are independent.
  assert.equal(limiter.consume("b", [rule]).ok, true);
  // The oldest hit leaves the window.
  now = 60_001;
  assert.equal(limiter.consume("a", [rule]).ok, true);
});

test("rejected requests do not extend their own lockout", () => {
  let now = 0;
  const limiter = new RateLimiter(() => now);
  limiter.consume("a", [rule]);
  limiter.consume("a", [rule]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    now += 1_000;
    assert.equal(limiter.consume("a", [rule]).ok, false);
  }
  now = 60_000;
  assert.equal(limiter.consume("a", [rule]).ok, true);
});

test("client identity comes from the first forwarded address", () => {
  const request = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
  assert.equal(clientKey(request), "203.0.113.9");
  assert.equal(clientKey(new Request("http://x")), "unknown-client");
});

test("enforceRateLimit returns a 429 with Retry-After once the global budget is spent", async () => {
  const limiter = new RateLimiter(() => 0);
  const global = [{ name: "global-test", windowMs: 60_000, max: 1 }];
  const from = (ip: string) => new Request("http://x", { headers: { "x-forwarded-for": ip } });
  assert.equal(enforceRateLimit(from("1.1.1.1"), [rule], global, limiter), null);
  const response = enforceRateLimit(from("2.2.2.2"), [rule], global, limiter);
  assert.equal(response?.status, 429);
  assert.equal(response?.headers.get("Retry-After"), "60");
  assert.match(((await response?.json()) as { error: string }).error, /lot of requests/);
});

test("diagram exports have their own budget", async () => {
  const { RATE_LIMITS } = await import("@/lib/safety/rateLimit");
  assert.deepEqual(RATE_LIMITS.diagram.map((rule) => [rule.name, rule.max]), [["diagram-minute", 30], ["diagram-day", 300]]);
});
