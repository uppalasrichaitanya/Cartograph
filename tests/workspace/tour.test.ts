/**
 * Guided tour: the measured-tour builder, the AI reading-order adapter, and
 * the `?tour=k` address.
 *
 * The measured tour is a pure function of the import graph and the Part F
 * reachability result, so every rule is tested on small hand-built graphs.
 *
 * @module tests/workspace/tour.test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TOUR_STEPS,
  aiTourSteps,
  buildMeasuredTour,
  tourSourceLabel,
} from "@/lib/workspace/tour";
import { parsePosition, samePosition, serializePosition, EMPTY_POSITION } from "@/lib/workspace/position";
import type { DependencyGraph, GraphNode, ReachabilityResult } from "@/types/graph";

function node(path: string): GraphNode {
  const slash = path.lastIndexOf("/");
  return { id: path, path, folder: slash < 0 ? "other" : path.slice(0, slash), lineCount: 10, imports: [], externalImports: [] };
}

function graphOf(paths: string[], edges: Array<[string, string]>): DependencyGraph {
  return {
    nodes: paths.map(node),
    edges: edges.map(([from, to]) => ({ id: `${from}->${to}`, from, to })),
  };
}

function reach(entries: Array<[string, string]>): ReachabilityResult {
  return { version: 1, entryPoints: entries.map(([path, reason]) => ({ path, reason })), unreachable: [], caveats: [] };
}

const REPO = graphOf(
  [
    "src/app/main.ts", "src/app/cli.ts", "src/core/store.ts", "src/core/log.ts", "src/core/util.ts",
    "src/ui/view.ts", "src/ui/theme.ts", "src/net/http.ts", "src/net/retry.ts", "tests/main.test.ts",
  ],
  [
    ["src/app/main.ts", "src/core/store.ts"], ["src/app/main.ts", "src/core/log.ts"], ["src/app/main.ts", "src/ui/view.ts"],
    ["src/app/main.ts", "src/net/http.ts"], ["src/app/cli.ts", "src/core/log.ts"],
    ["src/ui/view.ts", "src/ui/theme.ts"], ["src/ui/view.ts", "src/core/util.ts"],
    ["src/net/http.ts", "src/net/retry.ts"], ["src/net/http.ts", "src/core/log.ts"],
    ["src/core/store.ts", "src/core/util.ts"], ["src/core/store.ts", "src/core/log.ts"],
    ["tests/main.test.ts", "src/app/main.ts"], ["tests/main.test.ts", "src/app/cli.ts"],
    ["tests/main.test.ts", "src/core/store.ts"], ["tests/main.test.ts", "src/ui/view.ts"], ["tests/main.test.ts", "src/net/http.ts"],
  ],
);
const REACH = reach([
  ["src/app/main.ts", "conventional root file"],
  ["src/app/cli.ts", "script (bin/)"],
  ["tests/main.test.ts", "test file"],
]);

test("measured tour: entry points come first, with their reason", () => {
  const steps = buildMeasuredTour(REPO, REACH);
  assert.equal(steps[0].id, "src/app/main.ts");
  assert.match(steps[0].reason, /Entry point/);
  assert.match(steps[0].reason, /conventional root file/);
  assert.match(steps[0].reason, /Imports 4 files/);
  // Tests are entry points but never a place to start reading.
  assert.ok(!steps.some((s) => s.id === "tests/main.test.ts"));
});

test("measured tour: at most two entry points, then most-imported files", () => {
  const steps = buildMeasuredTour(REPO, REACH);
  const entries = steps.filter((s) => s.reason.startsWith("Entry point"));
  assert.ok(entries.length >= 1 && entries.length <= 2);
  assert.equal(steps.findIndex((s) => !s.reason.startsWith("Entry point")), entries.length, "entries are contiguous at the start");
  const log = steps.find((s) => s.id === "src/core/log.ts");
  assert.ok(log, "the most-imported file is on the tour");
  // main, cli, http, store import it: four importers from three regions (app, net, core).
  assert.match(log.reason, /^Imported by 4 source files across 3 regions/);
});

test("measured tour: scripts yield to other entry points", () => {
  const graph = graphOf(
    ["src/app/main.ts", "src/cli/run.ts", "scripts/gen.ts", "src/core/a.ts", "src/core/b.ts", "src/core/c.ts"],
    [
      ...fan("src/app/main.ts", ["src/core/a.ts", "src/core/b.ts"]),
      ...fan("src/cli/run.ts", ["src/core/a.ts"]),
      ...fan("scripts/gen.ts", ["src/core/a.ts", "src/core/b.ts", "src/core/c.ts", "src/app/main.ts"]),
    ],
  );
  const steps = buildMeasuredTour(graph, reach([
    ["src/app/main.ts", "conventional root file"], ["src/cli/run.ts", "conventional root file"], ["scripts/gen.ts", "script (scripts/)"],
  ]));
  assert.equal(steps[0].id, "src/app/main.ts");
  assert.ok(!steps.some((s) => s.id === "scripts/gen.ts"));
  // With only a script to go on, it still starts the tour.
  const only = buildMeasuredTour(graph, reach([["scripts/gen.ts", "script (scripts/)"]]));
  assert.equal(only[0].id, "scripts/gen.ts");
});

test("measured tour: hubs cover different regions before repeating one", () => {
  const steps = buildMeasuredTour(REPO, REACH);
  const hubRegions = steps.filter((s) => s.reason.startsWith("Imported by")).map((s) => node(s.id).folder);
  // core, ui and net all have importable files, so each is represented before any repeats.
  for (const region of ["src/core", "src/ui", "src/net"]) assert.ok(hubRegions.includes(region), region);
});

test("measured tour: at most 7 steps, no repeats, every step is a known file", () => {
  const paths = Array.from({ length: 12 }, (_, r) => Array.from({ length: 4 }, (_, f) => `pkg${r}/f${f}.ts`)).flat();
  const edges: Array<[string, string]> = [];
  paths.forEach((p, i) => { edges.push([p, paths[(i * 7 + 3) % paths.length]], [p, paths[(i * 5 + 1) % paths.length]]); });
  const graph = graphOf(paths, edges.filter(([a, b]) => a !== b));
  const steps = buildMeasuredTour(graph, reach([["pkg0/f0.ts", "conventional root file"], ["pkg1/f0.ts", "conventional root file"]]));
  assert.ok(steps.length <= MAX_TOUR_STEPS);
  assert.equal(MAX_TOUR_STEPS, 7);
  assert.equal(steps.length, 7);
  assert.equal(new Set(steps.map((s) => s.id)).size, steps.length);
  const known = new Set(paths);
  assert.ok(steps.every((s) => known.has(s.id)));
});

test("measured tour: covers remaining large regions with a representative", () => {
  const steps = buildMeasuredTour(REPO, REACH);
  const regions = new Set(steps.map((s) => node(s.id).folder));
  for (const region of ["src/app", "src/core", "src/ui", "src/net"]) assert.ok(regions.has(region), `${region} is visited`);
});

test("measured tour: without reachability it still works and never claims an entry point", () => {
  const steps = buildMeasuredTour(REPO, undefined);
  assert.ok(steps.length >= 3);
  assert.ok(!steps.some((s) => /Entry point/.test(s.reason)));
  assert.ok(!steps.some((s) => s.id === "tests/main.test.ts"));
  // A place to start reading is still offered, worded as what was measured.
  assert.equal(steps[0].id, "src/app/main.ts");
  assert.match(steps[0].reason, /no non-test file imports it/);
});

test("measured tour: zero recognised entry points behaves like no reachability", () => {
  assert.deepEqual(buildMeasuredTour(REPO, reach([])), buildMeasuredTour(REPO, undefined));
});

test("measured tour: is deterministic", () => {
  assert.deepEqual(
    buildMeasuredTour(REPO, REACH),
    buildMeasuredTour({ nodes: [...REPO.nodes].reverse(), edges: [...REPO.edges].reverse() }, REACH),
  );
});

test("measured tour: tiny repositories", () => {
  assert.deepEqual(buildMeasuredTour(graphOf([], []), undefined), []);
  assert.deepEqual(buildMeasuredTour(graphOf(["a.ts"], []), undefined).map((s) => s.id), ["a.ts"]);
  const two = buildMeasuredTour(graphOf(["a.ts", "b.ts"], [["a.ts", "b.ts"]]), undefined);
  assert.deepEqual(two.map((s) => s.id), ["a.ts", "b.ts"]);
  assert.match(two[1].reason, /Imported by 1 source file across 1 region\b/);
});

test("measured tour: ignores entry points that are not in the graph", () => {
  const steps = buildMeasuredTour(REPO, reach([["ghost.ts", "conventional root file"]]));
  assert.ok(!steps.some((s) => s.id === "ghost.ts"));
});

test("AI tour: keeps known files in order, drops unknown and repeated ones", () => {
  const known = new Set(["a.ts", "b.ts", "c.ts"]);
  const steps = aiTourSteps(
    [{ id: "a.ts", reason: "Start" }, { id: "nope.ts", reason: "x" }, { id: "b.ts", reason: "Next" }, { id: "a.ts", reason: "again" }],
    known,
  );
  assert.deepEqual(steps, [{ id: "a.ts", reason: "Start" }, { id: "b.ts", reason: "Next" }]);
  assert.equal(aiTourSteps(undefined, known), null);
  assert.equal(aiTourSteps([{ id: "a.ts", reason: "only one" }], known), null, "a single step is not a tour");
});

test("source labels say where the steps came from", () => {
  assert.equal(tourSourceLabel("ai"), "Guided by AI, with cited files");
  assert.equal(tourSourceLabel("measured"), "Measured from the import graph");
});

test("?tour=k: parsed, serialised and compared", () => {
  const none = new Set<string>();
  assert.equal(parsePosition(new URLSearchParams("tour=3"), none, none).tour, 3);
  assert.equal(parsePosition(new URLSearchParams(""), none, none).tour ?? null, null);
  for (const bad of ["0", "-1", "abc", "1.5", "", "2x", "99999"]) {
    assert.equal(parsePosition(new URLSearchParams(`tour=${bad}`), none, none).tour ?? null, null, `tour=${bad}`);
  }
  assert.equal(serializePosition({ ...EMPTY_POSITION, tour: 2 }), "?tour=2");
  assert.equal(serializePosition({ ...EMPTY_POSITION, tour: null }), "");
  assert.equal(samePosition({ ...EMPTY_POSITION, tour: 2 }, { ...EMPTY_POSITION, tour: 3 }), false);
  assert.equal(samePosition({ ...EMPTY_POSITION, tour: null }, EMPTY_POSITION), true);
});

/* ─── Newcomer paths on shapes taken from real repositories ─── */

/** Fan `from` out to each of `targets`. */
const fan = (from: string, targets: string[]): Array<[string, string]> => targets.map((to) => [from, to]);

const NEXT_APP = graphOf(
  [
    "app/layout.tsx", "app/page.tsx", "app/repo/[id]/page.tsx", "app/api/ai/route.ts", "app/api/big/route.ts",
    "components/Map.tsx", "components/Panel.tsx", "components/Icons.tsx",
    "lib/core/run.ts", "lib/core/plan.ts", "lib/core/types.ts", "lib/store/db.ts", "lib/store/cache.ts", "lib/store/index.ts",
    "examples/demo/App.tsx", "examples/demo/util.ts", "examples/demo/more.ts", "scripts/gen.ts", "website/src/pages/index.js",
    "website/src/a.js", "website/src/b.js",
  ],
  [
    ...fan("app/layout.tsx", ["components/Icons.tsx"]),
    ...fan("app/page.tsx", ["components/Map.tsx", "components/Panel.tsx"]),
    ...fan("app/repo/[id]/page.tsx", ["components/Map.tsx", "components/Panel.tsx", "lib/store/db.ts"]),
    ...fan("app/api/ai/route.ts", ["lib/core/run.ts", "lib/store/db.ts", "lib/store/cache.ts", "lib/core/plan.ts", "components/Icons.tsx", "lib/core/types.ts"]),
    ...fan("app/api/big/route.ts", ["lib/core/run.ts", "lib/store/db.ts", "lib/store/cache.ts", "lib/core/plan.ts", "components/Icons.tsx", "lib/core/types.ts", "lib/store/index.ts"]),
    ...fan("components/Map.tsx", ["components/Icons.tsx", "lib/core/types.ts"]),
    ...fan("components/Panel.tsx", ["components/Icons.tsx", "lib/core/types.ts", "lib/core/run.ts"]),
    ...fan("lib/core/run.ts", ["lib/core/plan.ts", "lib/core/types.ts", "lib/store/db.ts"]),
    ...fan("lib/core/plan.ts", ["lib/core/types.ts"]),
    ...fan("lib/store/db.ts", ["lib/store/cache.ts"]),
    ...fan("lib/store/index.ts", ["lib/store/db.ts"]),
    ...fan("examples/demo/App.tsx", ["examples/demo/util.ts", "lib/core/run.ts", "lib/store/db.ts", "examples/demo/more.ts"]),
    ...fan("examples/demo/more.ts", ["examples/demo/util.ts", "lib/core/run.ts"]),
    ...fan("scripts/gen.ts", ["lib/core/run.ts", "lib/store/db.ts", "lib/core/plan.ts"]),
    ...fan("website/src/pages/index.js", ["website/src/a.js", "website/src/b.js"]),
  ],
);
const NEXT_REACH = reach([
  ["app/layout.tsx", "Next.js route (app/layout.tsx)"],
  ["app/page.tsx", "Next.js route (app/page.tsx)"],
  ["app/repo/[id]/page.tsx", "Next.js route (app/repo/[id]/page.tsx)"],
  ["app/api/ai/route.ts", "Next.js route (app/api/ai/route.ts)"],
  ["app/api/big/route.ts", "Next.js route (app/api/big/route.ts)"],
  ["scripts/gen.ts", "script (scripts/)"],
  ["website/src/pages/index.js", "Next.js route (website/src/pages/index.js)"],
  ["examples/demo/App.tsx", "example or demo (examples/)"],
]);

test("newcomer path: the root layout and page open a Next.js app, ahead of API routes", () => {
  const steps = buildMeasuredTour(NEXT_APP, NEXT_REACH);
  assert.deepEqual(steps.slice(0, 2).map((s) => s.id), ["app/layout.tsx", "app/page.tsx"]);
  assert.ok(!steps.some((s) => s.id.startsWith("app/api/") && s.reason.startsWith("Entry point")), "API routes are not what a newcomer reads first");
});

test("newcomer path: examples, scripts, website and docs never appear after the entry steps", () => {
  const steps = buildMeasuredTour(NEXT_APP, NEXT_REACH);
  assert.ok(steps.length >= 4);
  for (const step of steps) assert.ok(!/^(examples|scripts|website|docs|benchmarks)\//.test(step.id), step.id);
  // Neither does a repository that is mostly examples fill the tour with them.
  const only = buildMeasuredTour(graphOf(["index.js", "lib/a.js", ...Array.from({ length: 6 }, (_, i) => `examples/e${i}/index.js`)], [
    ...fan("index.js", ["lib/a.js"]), ...Array.from({ length: 6 }, (_, i): [string, string] => [`examples/e${i}/index.js`, "lib/a.js"]),
    ...Array.from({ length: 5 }, (_, i): [string, string] => [`examples/e${i}/index.js`, `examples/e${i + 1}/index.js`]),
  ]), reach([["index.js", "conventional root file"]]));
  assert.ok(only.every((s) => !s.id.startsWith("examples/")));
});

test("newcomer path: type-only files do not dominate the hubs", () => {
  const steps = buildMeasuredTour(NEXT_APP, NEXT_REACH);
  const typeOnly = steps.filter((s) => /(^|\/)(types?|interfaces?|constants?)\.[jt]sx?$|\.d\.ts$/.test(s.id));
  assert.ok(typeOnly.length <= 1);
  // lib/core/types.ts is the most-imported file here, so it may be the one allowed.
  const behaviour = steps.filter((s) => s.reason.startsWith("Imported by") && !typeOnly.includes(s));
  assert.ok(behaviour.length >= 2);
  // Two type files that rank first and second: only the top may stay.
  const graph = graphOf(["index.ts", "src/types.ts", "src/interfaces.ts", "src/core.ts", "src/a.ts", "src/b.ts"], [
    ...fan("index.ts", ["src/core.ts", "src/types.ts", "src/interfaces.ts"]),
    ...fan("src/core.ts", ["src/types.ts", "src/interfaces.ts", "src/a.ts"]),
    ...fan("src/a.ts", ["src/types.ts", "src/interfaces.ts", "src/b.ts"]), ...fan("src/b.ts", ["src/types.ts"]),
  ]);
  const small = buildMeasuredTour(graph, reach([["index.ts", "conventional root file"]]));
  assert.ok(small.filter((s) => /types|interfaces/.test(s.id)).length <= 1);
});

test("newcomer path: a package's own entry beats its exports subpaths and browser map", () => {
  const graph = graphOf(
    ["index.js", "lib/axios.js", "lib/utils.js", "lib/adapters/http.js", "lib/adapters/xhr.js", "lib/core/Axios.js", "lib/core/settle.js"],
    [
      ...fan("index.js", ["lib/axios.js"]),
      ...fan("lib/axios.js", ["lib/core/Axios.js", "lib/utils.js"]),
      ...fan("lib/core/Axios.js", ["lib/utils.js", "lib/adapters/http.js"]),
      ...fan("lib/adapters/http.js", ["lib/utils.js", "lib/core/settle.js", "lib/core/Axios.js", "lib/axios.js"]),
      ...fan("lib/adapters/xhr.js", ["lib/utils.js", "lib/core/settle.js"]),
    ],
  );
  const steps = buildMeasuredTour(graph, reach([
    ["lib/adapters/http.js", 'package.json "browser" map'],
    ["lib/utils.js", 'package.json "exports" ("./unsafe/utils.js")'],
    ["lib/adapters/xhr.js", 'package.json "exports" ("./lib/adapters/xhr.js")'],
    ["index.js", 'package.json "module"'],
  ]));
  assert.equal(steps[0].id, "index.js");
  assert.ok(steps.slice(1).every((s) => !s.reason.startsWith("Entry point")), "exports and browser entries do not add entry steps");
});

test("newcomer path: entries are ordered by tier, then depth, then out-degree", () => {
  const graph = graphOf(
    ["src/index.ts", "src/deep/nested/index.ts", "cli/bin.ts", "src/a.ts", "src/b.ts", "src/c.ts"],
    [...fan("src/index.ts", ["src/a.ts"]), ...fan("src/deep/nested/index.ts", ["src/a.ts", "src/b.ts", "src/c.ts"]), ...fan("cli/bin.ts", ["src/a.ts", "src/b.ts"])],
  );
  const steps = buildMeasuredTour(graph, reach([
    ["src/deep/nested/index.ts", 'package.json "main"'], ["src/index.ts", 'package.json "main"'], ["cli/bin.ts", 'package.json "bin"'],
  ]));
  assert.equal(steps[0].id, "src/index.ts");
  assert.equal(steps[1].id, "cli/bin.ts", "one entry per kind, so the second main does not follow");
});

test("newcomer path: a large folder of leaf files does not outrank a connected region for the last steps", () => {
  const leaves = Array.from({ length: 8 }, (_, i) => `lib/parsers/p${i}.ts`);
  const graph = graphOf(["index.ts", "lib/core/a.ts", "lib/core/b.ts", "lib/core/c.ts", ...leaves], [
    ...fan("index.ts", ["lib/core/a.ts", "lib/core/b.ts", "lib/core/c.ts"]),
    ...fan("lib/core/a.ts", ["lib/core/b.ts", "lib/core/c.ts"]), ...fan("lib/core/b.ts", ["lib/core/c.ts"]),
    ...fan("index.ts", leaves.slice(0, 1)),
  ]);
  const steps = buildMeasuredTour(graph, reach([["index.ts", "conventional root file"]]));
  const core = steps.findIndex((s) => s.id.startsWith("lib/core/"));
  const parsers = steps.findIndex((s) => s.id.startsWith("lib/parsers/"));
  assert.ok(core >= 0);
  assert.ok(parsers < 0 || core < parsers);
});
