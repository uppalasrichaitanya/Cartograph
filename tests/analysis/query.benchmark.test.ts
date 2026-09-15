import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createGraphQuery, createLinearGraphQuery } from "../../lib/analysis/query";
import type { DependencyGraph } from "../../types/graph";

function fixture(size: number): DependencyGraph {
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: `file-${index}`,
    path: `src/file-${index}.ts`,
    folder: "src",
    lineCount: 1,
    imports: index === 0 ? [] : [`file-${index - 1}`],
    externalImports: [],
  }));
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `${node.id}->file-${index}`,
      from: node.id,
      to: `file-${index}`,
    })),
  };
}

test("indexed query benchmark smoke: point lookup stays sub-millisecond on 800 files", () => {
  const graph = fixture(800);
  const query = createGraphQuery(graph);
  const started = performance.now();
  for (let index = 0; index < 1000; index++) query.getNode(`file-${index % 800}`);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 200, `point-query smoke exceeded 200ms: ${elapsed.toFixed(2)}ms`);

  const linear = createLinearGraphQuery(graph);
  const linearStarted = performance.now();
  for (let index = 0; index < 1000; index++) linear.getNode(`file-${index % 800}`);
  const linearElapsed = performance.now() - linearStarted;
  assert.ok(elapsed < linearElapsed, `index ${elapsed.toFixed(2)}ms was not faster than linear ${linearElapsed.toFixed(2)}ms`);
});
