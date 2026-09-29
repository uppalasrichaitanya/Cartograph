import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleDelete } from "@/lib/api/deleteAnalysis";
import { handleSweep } from "@/lib/api/sweep";
import { createOwnerToken, hashOwnerToken } from "@/lib/ownership";
import { LocalStorage } from "@/lib/storage/local";
import type { AnalysisResult } from "@/types/graph";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

async function setup(run: (store: LocalStorage, token: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-api-"));
  const store = new LocalStorage(path.join(root, "analyses"));
  const token = createOwnerToken();
  await store.saveAnalysis({ id: ID } as AnalysisResult);
  await store.saveOwner(ID, { tokenHash: hashOwnerToken(token), createdAt: "2026-09-29T00:00:00.000Z" });
  try { await run(store, token); } finally { await rm(root, { recursive: true, force: true }); }
}

const request = (token?: string) => new Request(`http://test/api/analysis/${ID}`, {
  method: "DELETE",
  headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
});

test("the owner's token deletes; others are refused", async () => {
  await setup(async (store, token) => {
    assert.equal((await handleDelete(request(), ID, store)).status, 401);
    assert.equal((await handleDelete(request(createOwnerToken()), ID, store)).status, 403);
    assert.ok(await store.loadAnalysis(ID));
    assert.equal((await handleDelete(request(token), ID, store)).status, 204);
    assert.equal(await store.loadAnalysis(ID), null);
  });
});

test("a token for another analysis is refused, and a missing owner record is 404", async () => {
  await setup(async (store, token) => {
    await store.saveAnalysis({ id: OTHER } as AnalysisResult);
    assert.equal((await handleDelete(request(token), OTHER, store)).status, 404);
    assert.ok(await store.loadAnalysis(OTHER));
    await store.saveOwner(OTHER, { tokenHash: hashOwnerToken(createOwnerToken()), createdAt: "2026-09-29T00:00:00.000Z" });
    assert.equal((await handleDelete(request(token), OTHER, store)).status, 403);
  });
});

test("the sweep needs its secret and deletes only what is due", async () => {
  await setup(async (store) => {
    await store.markExpiry(ID, "2026-10-01T00:00:00.000Z");
    const sweep = (auth?: string, secret?: string) =>
      handleSweep(new Request("http://test/api/cron/sweep", { headers: auth ? { authorization: auth } : {} }), store, new Date("2026-10-02T00:00:00.000Z"), secret);
    assert.equal((await sweep("Bearer x", undefined)).status, 503);
    assert.equal((await sweep("Bearer wrong", "s3cret")).status, 401);
    const ok = await sweep("Bearer s3cret", "s3cret");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { deleted: 1 });
    assert.equal(await store.loadAnalysis(ID), null);
  });
});
