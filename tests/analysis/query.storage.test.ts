import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { LocalStorage } from "../../lib/storage/local";
import { queryAnalysis } from "../../lib/analysis/query/analysisResult";
import type { AnalysisResult } from "../../types/graph";

function result(id: string): AnalysisResult {
  return {
    id, createdAt: "2026-09-15T00:00:00.000Z", shareUrl: `/repo/${id}`,
    graph: {
      nodes: [{ id: "a", path: "a.ts", folder: "", lineCount: 1, imports: [], externalImports: [] }],
      edges: [],
    },
    clusters: [], anomalies: { cycles: [], godModules: [], orphans: ["a"] },
    parseErrors: [], renderData: { folderView: { nodes: [], edges: [] }, fileViewByFolder: {} },
    repoMeta: {
      repoName: "fixture", language: "TypeScript", framework: null, fileCount: 1,
      folderCount: 0, dependencyCount: 0, analysisTimestamp: "2026-09-15T00:00:00.000Z",
      repoSizeBytes: null,
    },
  };
}

test("local persisted analysis stays byte-compatible with the query adapter", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cartograph-query-storage-"));
  try {
    const dataDir = path.join(directory, "analyses");
    const storage = new LocalStorage(dataDir);
    const analysis = result("00000000-0000-4000-8000-000000000008");
    await storage.saveAnalysis(analysis);
    const raw = await readFile(path.join(dataDir, `${analysis.id}.json`), "utf8");
    assert.deepEqual(JSON.parse(raw), analysis);
    const loaded = await storage.loadAnalysis(analysis.id);
    assert.equal(loaded && queryAnalysis(loaded).getNode("a")?.id, "a");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
