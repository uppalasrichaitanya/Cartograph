import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStorage } from "@/lib/storage/local";
import type { AnalysisResult } from "@/types/graph";

const ID = "11111111-1111-4111-8111-111111111111";
const analysis = { id: ID } as AnalysisResult;

async function withStore(run: (store: LocalStorage, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-store-"));
  try {
    await run(new LocalStorage(path.join(root, "analyses")), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("owner records round-trip and reject bad ids", async () => {
  await withStore(async (store) => {
    await store.saveOwner(ID, { tokenHash: "a".repeat(64), createdAt: "2026-09-29T00:00:00.000Z" });
    assert.deepEqual(await store.loadOwner(ID), { tokenHash: "a".repeat(64), createdAt: "2026-09-29T00:00:00.000Z" });
    assert.equal(await store.loadOwner("../etc/passwd"), null);
  });
});

test("expiry markers list only ids due on or before now", async () => {
  await withStore(async (store) => {
    await store.markExpiry(ID, "2026-10-01T12:00:00.000Z");
    await store.markExpiry("22222222-2222-4222-8222-222222222222", "2026-12-01T00:00:00.000Z");
    assert.deepEqual(await store.listExpiredIds(new Date("2026-10-02T00:00:00.000Z")), [ID]);
  });
});

test("deleteAnalysis removes the analysis, its explanations, owner record, and markers", async () => {
  await withStore(async (store, root) => {
    await store.saveAnalysis(analysis);
    await store.saveExplanation(ID, "b".repeat(64), { answer: "x", claims: [] });
    await store.saveOwner(ID, { tokenHash: "a".repeat(64), createdAt: "2026-09-29T00:00:00.000Z" });
    await store.markExpiry(ID, "2026-10-01T12:00:00.000Z");
    await store.deleteAnalysis(ID);
    assert.equal(await store.loadAnalysis(ID), null);
    assert.equal(await store.loadExplanation(ID, "b".repeat(64)), null);
    assert.equal(await store.loadOwner(ID), null);
    assert.deepEqual(await store.listExpiredIds(new Date("2027-01-01T00:00:00.000Z")), []);
    await store.deleteAnalysis(ID); // idempotent
    assert.deepEqual((await readdir(root)).sort(), ["analyses", "expiry", "explanations", "owners"]);
  });
});
