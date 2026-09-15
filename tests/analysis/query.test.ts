import test from "node:test";
import assert from "node:assert/strict";
import { createGraphQuery, createLinearGraphQuery } from "../../lib/analysis/query";
import { IRBuilder } from "../../lib/analysis/ir/builder";
import type { DependencyGraph } from "../../types/graph";

const graph: DependencyGraph = {
  nodes: [
    { id: "a", path: "a.ts", folder: "", lineCount: 1, imports: ["b"], externalImports: [] },
    { id: "b", path: "b.ts", folder: "", lineCount: 1, imports: ["a", "c"], externalImports: [] },
    { id: "c", path: "c.ts", folder: "", lineCount: 1, imports: [], externalImports: [] },
  ],
  edges: [
    { id: "a->b", from: "a", to: "b" },
    { id: "b->a", from: "b", to: "a" },
    { id: "b->c", from: "b", to: "c" },
  ],
};

test("indexed graph query provides deterministic lookup and neighbors", () => {
  const query = createGraphQuery(graph);
  assert.equal(query.getNode("b")?.path, "b.ts");
  assert.deepEqual(query.getNeighbors("b", "outgoing").map((node) => node.id), ["a", "c"]);
  assert.deepEqual(query.getNeighbors("a", "incoming").map((node) => node.id), ["b"]);
  assert.deepEqual(query.getNeighbors("b", "both").map((node) => node.id), ["a", "c"]);
  assert.deepEqual(query.getNeighbors("missing"), []);
});

test("cycle and impact queries are stable and exclude the subject from impact", () => {
  const query = createGraphQuery(graph);
  assert.deepEqual(query.findCycles(), [["a", "b", "a"]]);
  assert.deepEqual(query.computeImpact("c").map((node) => node.id), ["a", "b"]);
  assert.deepEqual(query.computeImpact("a").map((node) => node.id), ["b"]);
  assert.deepEqual(query.computeImpact("missing"), []);
});

test("linear and indexed backends share the same contract", () => {
  const indexed = createGraphQuery(graph);
  const linear = createLinearGraphQuery(graph);
  for (const id of ["a", "b", "c", "missing"]) {
    assert.deepEqual(linear.getNode(id), indexed.getNode(id));
    assert.deepEqual(linear.getNeighbors(id, "both"), indexed.getNeighbors(id, "both"));
    assert.deepEqual(linear.computeImpact(id), indexed.computeImpact(id));
  }
  assert.deepEqual(linear.findCycles(), indexed.findCycles());
});

test("IR queries distinguish containment from dependency edges", () => {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json", "declared");
  const file = builder.buildFileNode({
    path: "src/a.ts", lineCount: 1, internalImports: [], externalImports: [],
    parseErrors: [], capabilitiesUsed: ["imports"],
  }, root);
  const ir = builder.finalize(
    [root, file],
    [builder.buildContainmentEdge(file, root)],
    [root],
  );
  const query = createGraphQuery(ir);
  assert.deepEqual(query.getNeighbors(root.id, "outgoing", ["contains"]).map((node) => node.id), [file.id]);
  assert.deepEqual(query.getNeighbors(root.id, "outgoing", ["imports"]), []);
  assert.deepEqual(query.findCycles(), []);
});
