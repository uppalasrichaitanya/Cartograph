import assert from "node:assert/strict";
import test from "node:test";
import { computeFolderClusters, REGION_LIMITS } from "@/lib/analysis/clusterByFolder";

const files = (folder: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${folder}/f${String(index).padStart(2, "0")}.ts`);

const names = (paths: string[], strategy?: "legacy" | "adaptive") =>
  computeFolderClusters(paths, strategy).map((cluster) => [cluster.name, cluster.fileIds.length]);

test("small repositories get the same regions under both strategies", () => {
  const paths = [...files("app", 9), ...files("components", 12), ...files("lib/a", 5), ...files("lib/b", 6), "x/one.ts"];
  assert.deepEqual(computeFolderClusters(paths, "adaptive"), computeFolderClusters(paths, "legacy"));
});

test("a region above the limit splits into qualifying sub-folders plus the rest", () => {
  const paths = [...files("lib/analysis", 20), ...files("lib/ai", 6), ...files("lib/safety", 8), "lib/tiny/one.ts", "lib/index.ts"];
  assert.ok(paths.length > REGION_LIMITS.maxRegionFiles);
  assert.deepEqual(names(paths), [
    ["lib", 2],             // own file + the 1-file sub-folder below the minimum
    ["lib/ai", 6],
    ["lib/analysis", 20],
    ["lib/safety", 8],
  ]);
});

test("a region with fewer than two qualifying sub-folders stays whole", () => {
  const paths = [...files("lib/core", 40), "lib/x/one.ts"];
  assert.deepEqual(names(paths), [["lib", 41]]);
});

test("splitting recurses into sub-regions that are still too large", () => {
  const paths = [...files("lib/analysis/parsers", 18), ...files("lib/analysis/ir", 16), ...files("lib/ai", 5)];
  assert.deepEqual(names(paths), [
    ["lib/ai", 5],
    ["lib/analysis/ir", 16],
    ["lib/analysis/parsers", 18],
  ]);
});

test("a chain-compressed region folder still splits", () => {
  // `lib` has no own files and one child, so the tree compresses it into `lib/core`.
  const paths = [...files("lib/core/a", 16), ...files("lib/core/b", 16)];
  assert.deepEqual(names(paths), [["lib/core/a", 16], ["lib/core/b", 16]]);
});

test("the src region only splits its own files, never files of other src regions", () => {
  // `src/f00.ts`… sit directly in src/ (region "src"); src/ui/* is its own region.
  const paths = [...files("src", 31), ...files("src/ui", 4)];
  const clusters = computeFolderClusters(paths);
  const src = clusters.find((cluster) => cluster.name === "src");
  const ui = clusters.find((cluster) => cluster.name === "src/ui");
  assert.equal(src?.fileIds.length, 31);
  assert.equal(ui?.fileIds.length, 4);
});

test("root files and tiny folders keep the legacy rules", () => {
  const paths = ["a.ts", "b.ts", "c.ts", "tools/one.ts", ...files("lib", 4)];
  assert.deepEqual(names(paths), [["lib", 4], ["other", 1], ["root", 3]]);
});

test("adaptive output is deterministic and partitions every file exactly once", () => {
  const paths = [...files("lib/analysis", 20), ...files("lib/ai", 6), ...files("lib/safety", 8), "lib/index.ts", "a.ts"];
  const first = computeFolderClusters(paths);
  assert.deepEqual(first, computeFolderClusters([...paths].reverse()));
  const all = first.flatMap((cluster) => cluster.fileIds).sort();
  assert.deepEqual(all, [...paths].sort());
});
