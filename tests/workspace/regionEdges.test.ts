import assert from "node:assert/strict";
import test from "node:test";
import { edgeStrokeWidth, regionEdgeCounts, regionSizeShare } from "@/lib/workspace/regionEdges";
import type { DependencyGraph } from "@/types/graph";

const node = (id: string, folder: string) => ({ id, path: id, folder, lineCount: 1, imports: [], externalImports: [] });

test("regionEdgeCounts counts file-level imports between regions and skips internal ones", () => {
  const graph: DependencyGraph = {
    nodes: [node("a/1.ts", "a"), node("a/2.ts", "a"), node("b/1.ts", "b")],
    edges: [
      { id: "1", from: "a/1.ts", to: "b/1.ts" },
      { id: "2", from: "a/2.ts", to: "b/1.ts" },
      { id: "3", from: "a/1.ts", to: "a/2.ts" },
      { id: "4", from: "b/1.ts", to: "a/1.ts" },
    ],
  };
  assert.deepEqual([...regionEdgeCounts(graph)], [["folder:a->folder:b", 2], ["folder:b->folder:a", 1]]);
});

test("edgeStrokeWidth grows logarithmically within bounds", () => {
  assert.equal(edgeStrokeWidth(1), 1.25);
  assert.equal(edgeStrokeWidth(2), 2);
  assert.equal(edgeStrokeWidth(1_000_000), 4.5);
  assert.equal(edgeStrokeWidth(0), 1.25);
});

test("regionSizeShare is a clamped proportion", () => {
  assert.equal(regionSizeShare(5, 10), 0.5);
  assert.equal(regionSizeShare(5, 0), 0);
  assert.equal(regionSizeShare(20, 10), 1);
});
