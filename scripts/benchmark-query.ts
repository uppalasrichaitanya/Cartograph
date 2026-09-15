import { performance } from "node:perf_hooks";
import { createGraphQuery, createLinearGraphQuery } from "../lib/analysis/query";
import type { DependencyGraph } from "../types/graph";

function fixture(size: number): DependencyGraph {
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: `file-${index}`,
    path: `src/file-${index}.ts`,
    folder: "src",
    lineCount: 1,
    imports: index ? [`file-${index - 1}`] : [],
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

function measure(action: () => void): number {
  const started = performance.now();
  action();
  return performance.now() - started;
}

for (const size of [100, 800, 5_000]) {
  const serialized = JSON.stringify(fixture(size));
  const graph = JSON.parse(serialized) as DependencyGraph;
  const linear = createLinearGraphQuery(graph);
  const indexed = createGraphQuery(graph);
  const lookups = Math.max(1_000, size);
  const linearPointMs = measure(() => {
    for (let index = 0; index < lookups; index++) linear.getNode(`file-${index % size}`);
  });
  const indexedPointMs = measure(() => {
    for (let index = 0; index < lookups; index++) indexed.getNode(`file-${index % size}`);
  });
  const impactMs = measure(() => { indexed.computeImpact("file-0"); });
  const cyclesMs = measure(() => { indexed.findCycles(); });
  console.log(JSON.stringify({ size, lookups, linearPointMs, indexedPointMs, impactMs, cyclesMs }));
}
