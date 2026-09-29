import assert from "node:assert/strict";
import test from "node:test";
import { loadLiveAnalysis } from "@/lib/storage/live";
import type { StorageBackend } from "@/lib/storage/interface";
import type { AnalysisResult } from "@/types/graph";

function fakeStore(result: Partial<AnalysisResult> | null) {
  const deleted: string[] = [];
  const store = {
    loadAnalysis: async () => result as AnalysisResult | null,
    deleteAnalysis: async (id: string) => { deleted.push(id); },
  } as unknown as StorageBackend;
  return { store, deleted };
}

const ID = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-30T00:00:00.000Z");

test("an expired analysis is gone and is deleted in the background", async () => {
  const { store, deleted } = fakeStore({ id: ID, retention: { expiresAt: "2026-10-29T00:00:00.000Z" } });
  assert.equal(await loadLiveAnalysis(store, ID, now), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(deleted, [ID]);
});

test("live, unexpiring, and legacy analyses load", async () => {
  for (const retention of [{ expiresAt: "2026-11-29T00:00:00.000Z" }, { expiresAt: null }, undefined]) {
    const { store, deleted } = fakeStore({ id: ID, ...(retention ? { retention } : {}) });
    assert.equal((await loadLiveAnalysis(store, ID, now))?.id, ID);
    assert.deepEqual(deleted, []);
  }
});

test("a missing analysis is null", async () => {
  const { store } = fakeStore(null);
  assert.equal(await loadLiveAnalysis(store, ID, now), null);
});

test("the background delete goes through the supplied scheduler", async () => {
  const { store, deleted } = fakeStore({ id: ID, retention: { expiresAt: "2026-10-29T00:00:00.000Z" } });
  const scheduled: Array<() => Promise<void>> = [];
  assert.equal(await loadLiveAnalysis(store, ID, now, (task) => { scheduled.push(task); }), null);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(deleted, []);
  await scheduled[0]();
  assert.deepEqual(deleted, [ID]);
});
