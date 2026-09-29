import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagramModel, packageName } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import type { DiagramOptions } from "@/lib/diagram/types";
import { makeResult, webApp } from "./fixtures";

const opts = (over: Partial<DiagramOptions> = {}): DiagramOptions => ({ ...defaultDiagramOptions("document"), ...over });
const ids = (model: { units: ReadonlyArray<{ id: string }> }) => model.units.map((unit) => unit.id);

test("overview shows one unit per top-level folder plus root files, tests hidden", () => {
  const model = buildDiagramModel(webApp(), opts({ detail: "overview" }));
  assert.deepEqual(ids(model), ["u:#files", "u:app", "u:components", "u:lib"]);
  assert.deepEqual(model.groups, []);
  assert.equal(model.omitted.testFiles, 3);
  assert.equal(model.units.find((unit) => unit.id === "u:#files")?.label, "(root files)");
});

test("standard detail expands the largest folders along their own sub-folders", () => {
  const model = buildDiagramModel(webApp(), opts());
  assert.deepEqual(model.groups.map((group) => [group.id, group.parentId]), [
    ["g:lib", null],
    ["g:lib/analysis", "g:lib"],
  ]);
  assert.deepEqual(ids(model), [
    "u:#files", "u:app", "u:components", "u:lib/ai", "u:lib/analysis/core", "u:lib/analysis/parsers", "u:lib/storage",
  ]);
  const core = model.units.find((unit) => unit.id === "u:lib/analysis/core");
  assert.equal(core?.label, "core");
  assert.equal(core?.groupId, "g:lib/analysis");
});

test("including tests adds the tests unit", () => {
  const model = buildDiagramModel(webApp(), opts({ detail: "overview", includeTests: true }));
  assert.ok(ids(model).includes("u:tests"));
  assert.equal(model.omitted.testFiles, 0);
});

test("unit budgets are never exceeded; the smallest units merge", () => {
  const spec = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`m${String(i).padStart(2, "0")}/a.ts`, []]));
  const model = buildDiagramModel(makeResult(spec), opts({ preset: "slide", detail: "overview" }));
  assert.ok(model.units.length <= 16);
  const merged = model.units.find((unit) => unit.id === "u:#small");
  assert.equal(merged?.label, "15 small folders");
  assert.equal(merged?.files, 15);
});

test("edges aggregate file imports between units; imports inside a unit are internal", () => {
  const model = buildDiagramModel(webApp(), opts({ detail: "overview" }));
  const libToLib = model.units.find((unit) => unit.id === "u:lib")?.internalImports;
  assert.ok((libToLib ?? 0) > 0);
  const appToLib = model.edges.find((edge) => edge.id === "e:u:app->u:lib");
  assert.equal(appToLib?.count, 3);
  assert.ok(appToLib && appToLib.sampleEdgeIds.length <= 5);
  assert.ok(model.edges.every((edge) => edge.from !== edge.to));
});

test("the edge budget keeps the heaviest edges and reports the rest", () => {
  // 12 folders; folder i imports folder j (i < j) from (j - i) files: 66 edges with varied weights.
  const spec: Record<string, string[]> = {};
  for (let i = 0; i < 12; i += 1) {
    for (let k = 0; k < 12; k += 1) spec[`d${String(i).padStart(2, "0")}/f${String(k).padStart(2, "0")}.ts`] = [];
  }
  for (let i = 0; i < 12; i += 1) {
    for (let j = i + 1; j < 12; j += 1) {
      for (let k = 0; k < j - i; k += 1) {
        spec[`d${String(i).padStart(2, "0")}/f${String(k).padStart(2, "0")}.ts`].push(`d${String(j).padStart(2, "0")}/f00.ts`);
      }
    }
  }
  const model = buildDiagramModel(makeResult(spec), opts({ detail: "overview" }));
  assert.equal(model.edges.length, 40);
  assert.equal(model.omitted.edges, 26);
  const minKept = Math.min(...model.edges.map((edge) => edge.count));
  assert.ok(model.omitted.edgeMaxCount <= minKept);
});

test("units and edges in a loop are marked, and cycle edges survive the budget", () => {
  const model = buildDiagramModel(makeResult({
    "a/1.ts": ["b/1.ts"], "a/2.ts": [], "a/3.ts": [],
    "b/1.ts": ["a/1.ts"], "b/2.ts": [], "b/3.ts": [],
    "c/1.ts": [], "c/2.ts": [], "c/3.ts": [],
  }), opts({ detail: "overview" }));
  assert.deepEqual(model.units.filter((unit) => unit.inCycle).map((unit) => unit.id), ["u:a", "u:b"]);
  assert.ok(model.edges.every((edge) => edge.inCycle));
});

test("external packages are counted per importing file and exclude built-ins", () => {
  const result = makeResult(
    { "a/1.ts": [], "a/2.ts": [], "a/3.ts": [] },
    { "a/1.ts": ["react", "react-dom/client", "node:fs", "fs", "@vercel/blob/client"], "a/2.ts": ["react"] },
  );
  const model = buildDiagramModel(result, opts());
  assert.deepEqual(model.externalPackages, [
    { name: "react", importingFiles: 2 },
    { name: "@vercel/blob", importingFiles: 1 },
    { name: "react-dom", importingFiles: 1 },
  ]);
});

test("package names follow each ecosystem's rules", () => {
  assert.equal(packageName("@scope/pkg/deep", "TypeScript"), "@scope/pkg");
  assert.equal(packageName("node:path", "TypeScript"), null);
  assert.equal(packageName("path", "TypeScript"), null);
  assert.equal(packageName("numpy.linalg", "Python"), "numpy");
  assert.equal(packageName("os", "Python"), null);
  assert.equal(packageName("github.com/spf13/cobra/doc", "Go"), "github.com/spf13/cobra");
  assert.equal(packageName("net/http", "Go"), null);
});

test("the model is deterministic", () => {
  assert.deepEqual(buildDiagramModel(webApp(), opts()), buildDiagramModel(webApp(), opts()));
});

test("title and subtitle describe what is drawn", () => {
  const model = buildDiagramModel(webApp(), opts());
  assert.equal(model.title, "fixture");
  assert.match(model.subtitle, /^Architecture overview · \d+ files · \d+ imports · TypeScript$/);
  assert.equal(model.analyzedAt, "2026-09-29T00:00:00.000Z");
});
