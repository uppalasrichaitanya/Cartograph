import assert from "node:assert/strict";
import test from "node:test";
import { buildGraph } from "@/lib/analysis/buildGraph";
import { computeReachability } from "@/lib/analysis/reachability";

const file = (filePath: string, imports: string[] = []) => ({ filePath, lineCount: 1, imports, externalImports: [] });
const entry = (path: string) => ({ path, reason: "test rule" });

test("a chain: everything downstream of an entry point is reachable", () => {
  const graph = buildGraph([file("a.ts", ["b.ts"]), file("b.ts", ["c.ts"]), file("c.ts"), file("island.ts")]);
  const result = computeReachability({ graph, entryPoints: [entry("a.ts")] });
  assert.equal(result.version, 1);
  assert.deepEqual(result.unreachable, ["island.ts"]);
  assert.deepEqual(result.entryPoints, [entry("a.ts")]);
});

test("a cycle reachable from an entry terminates; a cycle nothing reaches is unreachable", () => {
  const graph = buildGraph([
    file("a.ts", ["b.ts"]), file("b.ts", ["a.ts"]),
    file("x.ts", ["y.ts"]), file("y.ts", ["x.ts"]),
  ]);
  const result = computeReachability({ graph, entryPoints: [entry("a.ts")] });
  assert.deepEqual(result.unreachable, ["x.ts", "y.ts"]);
});

test("a disconnected island that imports a reachable file stays unreachable", () => {
  const graph = buildGraph([file("main.ts", ["lib.ts"]), file("lib.ts"), file("old.ts", ["lib.ts"])]);
  const result = computeReachability({ graph, entryPoints: [entry("main.ts")] });
  assert.deepEqual(result.unreachable, ["old.ts"]);
});

test("zero entry points: nothing is reported, and the caveat says why", () => {
  const graph = buildGraph([file("a.ts", ["b.ts"]), file("b.ts")]);
  const result = computeReachability({ graph, entryPoints: [] });
  assert.deepEqual(result.unreachable, []);
  assert.deepEqual(result.entryPoints, []);
  assert.ok(result.caveats.includes("No entry points recognised, so reachability was not computed"));
});

test("entry points that are not in the graph are dropped; all-dropped counts as zero", () => {
  const graph = buildGraph([file("a.ts")]);
  const result = computeReachability({ graph, entryPoints: [entry("ghost.ts")] });
  assert.deepEqual(result.entryPoints, []);
  assert.deepEqual(result.unreachable, []);
});

test(".d.ts files are never reported", () => {
  const graph = buildGraph([file("main.ts"), file("types.d.ts"), file("lonely.ts")]);
  const result = computeReachability({ graph, entryPoints: [entry("main.ts")] });
  assert.deepEqual(result.unreachable, ["lonely.ts"]);
});

test("entry points themselves are never listed as unreachable", () => {
  const graph = buildGraph([file("a.test.ts"), file("main.ts")]);
  const result = computeReachability({ graph, entryPoints: [entry("a.test.ts"), entry("main.ts")] });
  assert.deepEqual(result.unreachable, []);
});

test("reaching a Python module also reaches the __init__.py files of its packages", () => {
  const graph = buildGraph([
    file("app/main.py", ["app/sub/mod.py"]), file("app/sub/mod.py"),
    file("app/__init__.py"), file("app/sub/__init__.py"), file("other/__init__.py"),
  ]);
  const result = computeReachability({ graph, entryPoints: [entry("app/main.py")] });
  assert.deepEqual(result.unreachable, ["other/__init__.py"]);
});

test("reaching a Go file reaches the rest of its package directory", () => {
  const graph = buildGraph([
    file("cmd/main.go", ["lib/a.go"]), file("lib/a.go"), file("lib/b.go"), file("other/c.go"),
  ]);
  const result = computeReachability({ graph, entryPoints: [entry("cmd/main.go")] });
  assert.deepEqual(result.unreachable, ["other/c.go"]);
});

test("caveats for dynamic imports, unresolved internal imports and unrecognised frameworks", () => {
  const graph = buildGraph([file("main.ts")]);
  const none = computeReachability({ graph, entryPoints: [entry("main.ts")] });
  assert.deepEqual(none.caveats, []);

  const result = computeReachability({
    graph,
    entryPoints: [entry("main.ts")],
    signals: { dynamicImportFiles: 2, unresolvedInternalImports: 3, unrecognisedFrameworks: ["Nuxt"] },
  });
  assert.equal(result.caveats.length, 3);
  assert.match(result.caveats[0], /2 files use dynamic or non-literal imports/);
  assert.match(result.caveats[1], /3 internal imports could not be resolved/);
  assert.match(result.caveats[2], /Nuxt/);
});

test("wording never states a verdict", () => {
  const graph = buildGraph([file("main.ts")]);
  const result = computeReachability({
    graph,
    entryPoints: [entry("main.ts")],
    signals: { dynamicImportFiles: 1, unresolvedInternalImports: 1, unrecognisedFrameworks: ["Nuxt"] },
  });
  for (const caveat of result.caveats) assert.doesNotMatch(caveat, /\bdead\b|\bunused\b/i);
});
