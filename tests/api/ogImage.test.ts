import assert from "node:assert/strict";
import test from "node:test";
import { handleOgImage, type OgImageDeps } from "@/lib/api/ogImage";
import { DiagramScopeError } from "@/lib/diagram";
import type { StorageBackend } from "@/lib/storage";
import type { AnalysisResult } from "@/types/graph";

const ID = "33333333-3333-4333-8333-333333333333";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const stored = { id: ID } as AnalysisResult;

const request = () => new Request(`https://cartograph.test/api/og/${ID}`, {
  headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` },
});
const deps = (over: Partial<OgImageDeps> = {}): OgImageDeps => ({
  storage: {} as StorageBackend,
  load: async () => stored,
  render: async () => PNG,
  ...over,
});

test("a bad id is 404 without touching storage", async () => {
  let loads = 0;
  const response = await handleOgImage(request(), "../etc", deps({ load: async () => { loads += 1; return stored; } }));
  assert.equal(response.status, 404);
  assert.equal(loads, 0);
});

test("a missing or expired analysis is 404", async () => {
  assert.equal((await handleOgImage(request(), ID, deps({ load: async () => null }))).status, 404);
});

test("a found analysis is a cacheable PNG", async () => {
  const response = await handleOgImage(request(), ID, deps());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=3600");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...PNG]);
});

test("a render failure redirects to the default card", async () => {
  for (const error of [new DiagramScopeError("empty"), new Error("boom")]) {
    const response = await handleOgImage(request(), ID, deps({ render: async () => { throw error; } }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://cartograph.test/og-default.png");
    assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=3600");
  }
});

test("the route is rate limited", async () => {
  const same = () => new Request(`https://cartograph.test/api/og/${ID}`, { headers: { "x-forwarded-for": "10.9.9.9" } });
  let last = 200;
  for (let i = 0; i < 121; i += 1) last = (await handleOgImage(same(), ID, deps())).status;
  assert.equal(last, 429);
});

test("a really expired analysis flows through loadLiveAnalysis to a 404", async () => {
  let deleted = 0;
  const storage = {
    loadAnalysis: async () => ({ id: ID, retention: { expiresAt: "2020-01-01T00:00:00.000Z" } }) as AnalysisResult,
    deleteAnalysis: async () => { deleted += 1; },
  } as unknown as StorageBackend;
  const response = await handleOgImage(request(), ID, { storage, render: async () => PNG });
  assert.equal(response.status, 404);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deleted, 1);
});
