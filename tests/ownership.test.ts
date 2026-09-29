import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerToken, expiresAt, hashOwnerToken, isExpired, parseRetention, verifyOwnerToken } from "@/lib/ownership";

test("tokens are 256-bit base64url and unique", () => {
  const a = createOwnerToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, createOwnerToken());
});

test("only the matching token verifies against a hash", () => {
  const token = createOwnerToken();
  const hash = hashOwnerToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(verifyOwnerToken(token, hash), true);
  assert.equal(verifyOwnerToken(createOwnerToken(), hash), false);
  assert.equal(verifyOwnerToken("", hash), false);
  assert.equal(verifyOwnerToken(token, "not-a-hash"), false);
});

test("retention choices map to expiry dates; unknown values fall back to 30 days", () => {
  assert.equal(parseRetention("7d"), "7d");
  assert.equal(parseRetention("forever"), "30d");
  assert.equal(parseRetention(undefined), "30d");
  assert.equal(expiresAt("2026-09-29T10:00:00.000Z", "7d"), "2026-10-06T10:00:00.000Z");
  assert.equal(expiresAt("2026-09-29T10:00:00.000Z", "30d"), "2026-10-29T10:00:00.000Z");
  assert.equal(expiresAt("2026-09-29T10:00:00.000Z", "manual"), null);
});

test("expiry applies only to analyses that recorded one", () => {
  const now = new Date("2026-10-30T00:00:00.000Z");
  assert.equal(isExpired({ expiresAt: "2026-10-29T10:00:00.000Z" }, now), true);
  assert.equal(isExpired({ expiresAt: "2026-11-29T10:00:00.000Z" }, now), false);
  assert.equal(isExpired({ expiresAt: null }, now), false);
  assert.equal(isExpired(undefined, now), false);
});
