/**
 * Phase 5 — Search
 *
 * The defect being fixed: search matched by subsequence with NO scoring, kept
 * raw graph order, and hard-sliced to 50. The best match could be item 40, or
 * excluded entirely. The cap was concealing the absence of ranking.
 *
 * These tests pin the ordering guarantees, the matched-character reporting
 * that makes the ordering checkable, and the boundary of what is searchable.
 *
 * @module tests/workspace/search.test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  highlightSegments,
  rankSearchItems,
  type SearchItem,
} from "@/lib/workspace/search";
import { buildSearchItems } from "@/lib/workspace/searchItems";
import type { DependencyGraph } from "@/types/graph";
import type { RepositoryIR } from "@/lib/analysis/ir/types";

const item = (
  label: string,
  context: string,
  weight = 0,
  kind: SearchItem["kind"] = "file",
): SearchItem => ({
  id: `${kind}:${context}:${label}`,
  label,
  context,
  target: context,
  kind,
  weight,
});

const labels = (items: ReadonlyArray<SearchItem>, query: string) =>
  rankSearchItems(items, query, 50).results.map((r) => r.item.label);

// ---------------------------------------------------------------------------
// Tier ordering
// ---------------------------------------------------------------------------

test("Phase 5 — better matches rank higher", async (t) => {
  await t.test("exact beats prefix beats boundary beats subsequence", () => {
    const items = [
      item("bxuxixlxdxexr.ts", "a/bxuxixlxdxexr.ts"), // subsequence only
      item("ir-builder.ts", "a/ir-builder.ts"), // boundary (after '-')
      item("builder.test.ts", "a/builder.test.ts"), // prefix
      item("builder", "a/builder"), // exact
    ];
    assert.deepEqual(labels(items, "builder"), [
      "builder",
      "builder.test.ts",
      "ir-builder.ts",
      "bxuxixlxdxexr.ts",
    ]);
  });

  await t.test("the best match is first, not merely present", () => {
    // The original defect, stated directly: `builder.ts` must not be buried
    // behind incidental subsequence hits.
    const items = [
      ...Array.from({ length: 60 }, (_, i) =>
        item(`bundleXderived${i}.ts`, `z/bundleXderived${i}.ts`),
      ),
      item("builder.ts", "lib/ir/builder.ts"),
    ];
    const { results } = rankSearchItems(items, "builder", 50);
    assert.equal(results[0].item.label, "builder.ts");
  });

  await t.test("a label match always beats a context match", () => {
    // Searching a file's name should outrank hitting only its folder path.
    const items = [
      item("helper.ts", "src/builder/helper.ts"), // 'builder' in context
      item("builder.ts", "src/other/builder.ts"), // 'builder' in label
    ];
    assert.deepEqual(labels(items, "builder"), ["builder.ts", "helper.ts"]);
  });

  await t.test("camelCase interiors count as boundaries", () => {
    const items = [
      item("xgraphx.ts", "a/xgraphx.ts"), // interior, not a boundary
      item("buildGraph.ts", "a/buildGraph.ts"), // boundary at 'G'
    ];
    assert.deepEqual(labels(items, "graph"), ["buildGraph.ts", "xgraphx.ts"]);
  });

  await t.test("matching is case-insensitive", () => {
    const items = [item("BuildGraph.ts", "a/BuildGraph.ts")];
    assert.equal(labels(items, "buildgraph")[0], "BuildGraph.ts");
  });

  await t.test("non-matches are excluded", () => {
    const items = [item("alpha.ts", "a/alpha.ts")];
    assert.deepEqual(labels(items, "zzz"), []);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaking
// ---------------------------------------------------------------------------

test("Phase 5 — structure breaks ties, never overrides quality", async (t) => {
  await t.test("equal matches order by how depended-upon they are", () => {
    const items = [
      item("index.ts", "a/index.ts", 1),
      item("index.ts", "b/index.ts", 40),
    ];
    const { results } = rankSearchItems(items, "index", 50);
    assert.equal(results[0].item.context, "b/index.ts");
  });

  await t.test("weight cannot promote a weaker tier", () => {
    // A heavily-depended-upon subsequence match must still lose to a prefix
    // match with no dependents. Otherwise ranking would stop meaning "matched
    // better" and start meaning "more popular".
    const items = [
      item("bxuxixlxdxexr.ts", "a/bxuxixlxdxexr.ts", 9999),
      item("builder.ts", "b/builder.ts", 0),
    ];
    assert.deepEqual(labels(items, "builder"), [
      "builder.ts",
      "bxuxixlxdxexr.ts",
    ]);
  });

  await t.test("ordering is stable for identical queries", () => {
    const items = [
      item("b.ts", "x/b.ts", 5),
      item("a.ts", "x/a.ts", 5),
      item("c.ts", "x/c.ts", 5),
    ];
    const first = labels(items, ".ts");
    const second = labels(items, ".ts");
    assert.deepEqual(first, second);
  });
});

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

test("Phase 5 — the cap truncates the tail, not the head", async (t) => {
  const items = Array.from({ length: 200 }, (_, i) =>
    item(`file${String(i).padStart(3, "0")}.ts`, `a/file${i}.ts`, i),
  );

  await t.test("the result count is capped", () => {
    assert.equal(rankSearchItems(items, "file", 10).results.length, 10);
  });

  await t.test("the true total is reported alongside", () => {
    // So the interface can say results were truncated rather than implying
    // that is all there is.
    assert.equal(rankSearchItems(items, "file", 10).total, 200);
  });

  await t.test("what survives the cap is the best, not the first", () => {
    const { results } = rankSearchItems(items, "file", 5);
    // All tie on tier, so the most-depended-upon win.
    assert.deepEqual(
      results.map((r) => r.item.weight),
      [199, 198, 197, 196, 195],
    );
  });
});

// ---------------------------------------------------------------------------
// Empty query
// ---------------------------------------------------------------------------

test("Phase 5 — an empty query offers a useful starting point", async (t) => {
  await t.test("the most depended-upon come first", () => {
    // An arbitrary slice of graph order tells a person nothing. What most of
    // the repository relies on is a defensible place to start reading.
    const items = [
      item("rare.ts", "a/rare.ts", 0),
      item("core.ts", "a/core.ts", 30),
      item("mid.ts", "a/mid.ts", 5),
    ];
    assert.deepEqual(labels(items, ""), ["core.ts", "mid.ts", "rare.ts"]);
  });

  await t.test("whitespace counts as empty", () => {
    const items = [item("a.ts", "x/a.ts", 1)];
    assert.equal(rankSearchItems(items, "   ", 50).results.length, 1);
  });

  await t.test("nothing is highlighted when nothing was queried", () => {
    const items = [item("a.ts", "x/a.ts", 1)];
    assert.deepEqual(rankSearchItems(items, "", 50).results[0].matchedIndices, []);
  });
});

// ---------------------------------------------------------------------------
// Showing why a result matched
// ---------------------------------------------------------------------------

test("Phase 5 — the ranking is inspectable", async (t) => {
  await t.test("matched indices are reported", () => {
    const { results } = rankSearchItems([item("builder.ts", "a/b.ts")], "build", 50);
    assert.deepEqual(results[0].matchedIndices, [0, 1, 2, 3, 4]);
    assert.equal(results[0].matchedField, "label");
  });

  await t.test("a context match reports against the context", () => {
    const { results } = rankSearchItems(
      [item("helper.ts", "src/builder/helper.ts")],
      "builder",
      50,
    );
    assert.equal(results[0].matchedField, "context");
    assert.ok(results[0].matchedIndices.length > 0);
  });

  await t.test("segments reconstruct the original text exactly", () => {
    const text = "buildGraph.ts";
    const segments = highlightSegments(text, [5, 6, 7, 8, 9]);
    assert.equal(segments.map((s) => s.text).join(""), text);
  });

  await t.test("segments mark exactly the matched characters", () => {
    const segments = highlightSegments("builder.ts", [0, 1, 2]);
    assert.deepEqual(segments, [
      { text: "bui", matched: true },
      { text: "lder.ts", matched: false },
    ]);
  });

  await t.test("non-adjacent matches produce separate runs", () => {
    const segments = highlightSegments("abcdef", [0, 3]);
    assert.deepEqual(segments, [
      { text: "a", matched: true },
      { text: "bc", matched: false },
      { text: "d", matched: true },
      { text: "ef", matched: false },
    ]);
  });

  await t.test("no indices yields one unmatched segment", () => {
    assert.deepEqual(highlightSegments("abc", []), [
      { text: "abc", matched: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// What is searchable
// ---------------------------------------------------------------------------

const graph: DependencyGraph = {
  nodes: [
    { id: "src/a.ts", path: "src/a.ts", folder: "src", lineCount: 10, imports: [], externalImports: [] },
    { id: "src/b.ts", path: "src/b.ts", folder: "src", lineCount: 5, imports: [], externalImports: [] },
  ],
  edges: [{ id: "e1", from: "src/b.ts", to: "src/a.ts" }],
};

const ir = {
  irVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  roots: [],
  nodes: [
    { id: "n1", kind: "File", path: "src/a.ts" },
    { id: "n2", kind: "File", path: "src/b.ts" },
    { id: "p1", kind: "ExternalDependency", name: "react" },
  ],
  edges: [
    { id: "ie1", kind: "imports", from: "n1", to: "p1" },
    { id: "ie2", kind: "imports", from: "n2", to: "p1" },
  ],
} as unknown as RepositoryIR;

test("Phase 5 — files and external packages, nothing more", async (t) => {
  await t.test("files are labelled by basename, with the path as context", () => {
    // People search for what a file is called; the path disambiguates.
    const items = buildSearchItems(graph, null);
    const a = items.find((i) => i.target === "src/a.ts");
    assert.equal(a?.label, "a.ts");
    assert.equal(a?.context, "src/a.ts");
  });

  await t.test("in-degree becomes the tiebreaker weight", () => {
    const items = buildSearchItems(graph, null);
    assert.equal(items.find((i) => i.target === "src/a.ts")?.weight, 1);
    assert.equal(items.find((i) => i.target === "src/b.ts")?.weight, 0);
  });

  await t.test("packages are searchable, once per importer", () => {
    // A package has no location in the map, so one row per importer gives
    // every result a real destination.
    const items = buildSearchItems(graph, ir);
    const packages = items.filter((i) => i.kind === "package");
    assert.equal(packages.length, 2);
    assert.ok(packages.every((p) => p.label === "react"));
    assert.deepEqual(
      packages.map((p) => p.target).sort(),
      ["src/a.ts", "src/b.ts"],
    );
  });

  await t.test("a package query finds its importers", () => {
    const items = buildSearchItems(graph, ir);
    const { results } = rankSearchItems(items, "react", 50);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.item.kind === "package"));
  });

  await t.test("without an IR there are no package results", () => {
    // No IR means no verified record of what is imported. Inventing the list
    // would be fabrication.
    const items = buildSearchItems(graph, null);
    assert.equal(items.filter((i) => i.kind === "package").length, 0);
  });

  await t.test("a file-name query outranks package matches", () => {
    // Adding packages must not drown out a query that was about a file.
    const withPackage = buildSearchItems(graph, {
      ...ir,
      nodes: [
        ...ir.nodes,
        { id: "p2", kind: "ExternalDependency", name: "a.ts-helper" },
      ],
      edges: [...ir.edges, { id: "ie3", kind: "imports", from: "n2", to: "p2" }],
    } as unknown as RepositoryIR);
    const { results } = rankSearchItems(withPackage, "a.ts", 50);
    assert.equal(results[0].item.kind, "file");
  });
});

// ---------------------------------------------------------------------------
// Package results use the same navigation contract as file results
// ---------------------------------------------------------------------------

/**
 * Selecting a search result calls navigateToNode(item.target) without
 * inspecting item.kind, so both kinds share one navigation path — including
 * the cross-region correction made in Phase 5.
 *
 * These tests pin the property that makes that sharing valid: a package's
 * target must be a real graph node id, indistinguishable at the point of use
 * from a file's target. If a package ever carried a target that were not a
 * navigable node — the package's own name, say — selection would silently do
 * nothing, and the shared path would be shared in name only.
 */
test("Phase 5 — package targets are ordinary graph nodes", async (t) => {
  // Two regions, with the package imported from the FAR one, so selecting it
  // is necessarily a cross-boundary navigation.
  const twoRegionGraph: DependencyGraph = {
    nodes: [
      { id: "src/core/a.ts", path: "src/core/a.ts", folder: "src/core", lineCount: 10, imports: [], externalImports: [] },
      { id: "src/ui/x.ts", path: "src/ui/x.ts", folder: "src/ui", lineCount: 8, imports: [], externalImports: [] },
    ],
    edges: [],
  };
  const twoRegionIr = {
    irVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    roots: [],
    nodes: [
      { id: "n1", kind: "File", path: "src/core/a.ts" },
      { id: "n2", kind: "File", path: "src/ui/x.ts" },
      { id: "p1", kind: "ExternalDependency", name: "react" },
    ],
    edges: [{ id: "ie1", kind: "imports", from: "n2", to: "p1" }],
  } as unknown as RepositoryIR;

  const items = buildSearchItems(twoRegionGraph, twoRegionIr);
  const nodeIds = new Set(twoRegionGraph.nodes.map((n) => n.id));

  await t.test("every target resolves to a graph node, whatever the kind", () => {
    for (const searchItem of items) {
      assert.ok(
        nodeIds.has(searchItem.target),
        `${searchItem.kind} "${searchItem.label}" targets "${searchItem.target}", which is not a node`,
      );
    }
  });

  await t.test("a package targets its importer, never itself", () => {
    const pkg = items.find((i) => i.kind === "package");
    assert.ok(pkg);
    assert.equal(pkg!.target, "src/ui/x.ts");
    assert.notEqual(pkg!.target, pkg!.label, "the package name is not a place");
  });

  await t.test("a package target can lie outside the current region", () => {
    // The case the Phase 5 defect broke: selecting this from src/core must
    // move region AND keep the selection.
    const pkg = items.find((i) => i.kind === "package");
    const targetNode = twoRegionGraph.nodes.find((n) => n.id === pkg!.target);
    assert.equal(targetNode?.folder, "src/ui");
    assert.notEqual(targetNode?.folder, "src/core");
  });

  await t.test("file and package targets are the same shape", () => {
    // Nothing at the selection site can tell them apart, which is what lets
    // one navigation path serve both.
    const file = items.find((i) => i.kind === "file")!;
    const pkg = items.find((i) => i.kind === "package")!;
    assert.equal(typeof file.target, typeof pkg.target);
    assert.ok(nodeIds.has(file.target) && nodeIds.has(pkg.target));
  });
});
