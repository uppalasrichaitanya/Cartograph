/**
 * Routed file edges: the file view asks ELK for orthogonal routes anchored on
 * a port of their own on each node's east (out) and west (in) side; the region
 * view stays unrouted.
 *
 * @module tests/ir/routedEdges.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildRepositoryIR } from "@/lib/analysis/ir/bridge";
import { extractAll, toLegacyResult } from "@/lib/analysis/extractAll";
import { buildGraph } from "@/lib/analysis/buildGraph";
import { clusterByFolder } from "@/lib/analysis/clusterByFolder";
import { prepareRenderData } from "@/lib/analysis/prepareRenderData";
import { ParserRegistry } from "@/lib/analysis/parsers/registry";
import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";

async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-routed-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fx" }));
  await mkdir(path.join(dir, "src", "core"), { recursive: true });
  await mkdir(path.join(dir, "src", "ui"), { recursive: true });

  await writeFile(
    path.join(dir, "src", "core", "a.ts"),
    [
      `import { x } from "../ui/x";`,
      `import { b } from "./b";`,
      `export const a = () => x + b;`,
    ].join("\n"),
  );
  await writeFile(path.join(dir, "src", "core", "b.ts"), `export const b = 1;\n`);
  await writeFile(path.join(dir, "src", "core", "c.ts"), `export const c = 2;\n`);

  await writeFile(
    path.join(dir, "src", "ui", "x.ts"),
    [`import { c } from "../core/c";`, `export const x = c;`].join("\n"),
  );
  await writeFile(path.join(dir, "src", "ui", "y.ts"), `export const y = 3;\n`);
  await writeFile(path.join(dir, "src", "ui", "z.ts"), `export const z = 4;\n`);

  return dir;
}

async function analyze(dir: string) {
  const registry = new ParserRegistry();
  registry.register(new TypeScriptParser());
  const rel = [
    "src/core/a.ts",
    "src/core/b.ts",
    "src/core/c.ts",
    "src/ui/x.ts",
    "src/ui/y.ts",
    "src/ui/z.ts",
  ];
  const discovered = rel.map((r) => ({
    absolutePath: path.join(dir, r),
    relativePath: r,
  }));
  await registry.initializeAll({ projectRoot: dir, discoveredFiles: discovered });
  const extraction = await extractAll(dir, discovered, registry);
  registry.disposeAll();

  const { files, parseErrors } = toLegacyResult(extraction);
  const graph = buildGraph(files);
  const clusters = clusterByFolder(graph);
  const ir = buildRepositoryIR(dir, extraction.extractions);
  assert.ok(ir, "IR construction must succeed");
  const renderData = await prepareRenderData(graph, clusters, ir, parseErrors);
  return { renderData };
}

test("file-view edges between distinct nodes carry axis-aligned routes anchored on the node boxes", async () => {
  const dir = await makeFixture();
  try {
    const { renderData } = await analyze(dir);
    let checked = 0;
    for (const view of Object.values(renderData.fileViewByFolder)) {
      const byId = new Map(view.nodes.map((node) => [node.id, node]));
      for (const edge of view.edges) {
        if (edge.source === edge.target) continue;
        const route = edge.route;
        assert.ok(route && route.length >= 2, `${edge.id} has no route`);
        const source = byId.get(edge.source)!;
        const target = byId.get(edge.target)!;
        const start = route[0];
        const end = route[route.length - 1];
        assert.ok(Math.abs(start.x - (source.position.x + source.width!)) <= 1, `${edge.id} start x`);
        const anchor = edge.anchor;
        assert.ok(anchor, `${edge.id} has no anchor`);
        assert.ok(Math.abs(start.y - (source.position.y + source.height! / 2 + anchor.source)) <= 0.2, `${edge.id} start y`);
        assert.ok(Math.abs(end.x - target.position.x) <= 1, `${edge.id} end x`);
        assert.ok(Math.abs(end.y - (target.position.y + target.height! / 2 + anchor.target)) <= 0.2, `${edge.id} end y`);
        assert.ok(Math.abs(anchor.source) <= source.height! / 2 && Math.abs(anchor.target) <= target.height! / 2, `${edge.id} anchor inside box`);
        for (let i = 1; i < route.length; i += 1) {
          const [a, b] = [route[i - 1], route[i]];
          assert.ok(Math.abs(a.x - b.x) < 0.11 || Math.abs(a.y - b.y) < 0.11, `${edge.id} segment ${i} is diagonal`);
        }
        checked += 1;
      }
    }
    assert.ok(checked >= 3, "fixture must exercise intra-region and boundary edges");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("arrows into the same node arrive at separate points", async () => {
  const graph = {
    nodes: [file("a.ts"), file("b.ts"), file("c.ts")],
    edges: [
      { id: "a-c", from: "a.ts", to: "c.ts" },
      { id: "b-c", from: "b.ts", to: "c.ts" },
      { id: "c-a", from: "c.ts", to: "a.ts" },
    ],
  };
  const data = await prepareRenderData(graph, [{ name: "r", fileIds: ["a.ts", "b.ts", "c.ts"] }], null, []);
  const edges = data.fileViewByFolder["r"].edges;
  const end = (id: string) => edges.find((e) => e.id === id)!.route!.at(-1)!;
  assert.ok(Math.abs(end("a-c").y - end("b-c").y) >= 8, "the two arrows into c end apart");
  const anchors = edges.filter((e) => e.target === "c.ts").map((e) => e.anchor!.target);
  assert.notEqual(anchors[0], anchors[1]);
  // A lone port stays centred.
  assert.equal(edges.find((e) => e.id === "c-a")!.anchor!.target, 0);
});

test("region-view edges are not routed", async () => {
  const dir = await makeFixture();
  try {
    const { renderData } = await analyze(dir);
    assert.ok(renderData.folderView.edges.length > 0, "fixture must produce region edges");
    for (const edge of renderData.folderView.edges) {
      assert.equal(edge.route, undefined);
      assert.equal(edge.anchor, undefined);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const file = (id: string) => ({ id, path: id, folder: "r", lineCount: 1, imports: [], externalImports: [] });

test("a self-edge gets no route while its neighbours do", async () => {
  const graph = {
    nodes: [file("a.ts"), file("b.ts")],
    edges: [
      { id: "a-a", from: "a.ts", to: "a.ts" },
      { id: "a-b", from: "a.ts", to: "b.ts" },
    ],
  };
  const data = await prepareRenderData(graph, [{ name: "r", fileIds: ["a.ts", "b.ts"] }], null, []);
  const edges = data.fileViewByFolder["r"].edges;
  assert.equal(edges.find((e) => e.id === "a-a")!.route, undefined);
  assert.ok(edges.find((e) => e.id === "a-b")!.route);
});

test("when ELK fails, nodes fall back to the grid and edges carry no routes", async () => {
  // An edge to a file that is in the region but has no node makes ELK throw.
  const graph = {
    nodes: [file("a.ts")],
    edges: [{ id: "a-ghost", from: "a.ts", to: "ghost.ts" }],
  };
  const data = await prepareRenderData(graph, [{ name: "r", fileIds: ["a.ts", "ghost.ts"] }], null, []);
  const view = data.fileViewByFolder["r"];
  assert.deepEqual(view.nodes[0].position, { x: 0, y: 0 });
  assert.equal(view.edges.length, 1);
  assert.equal(view.edges[0].route, undefined);
});

test("edges between the same pair and ids containing '::' each get their own route and anchor", async () => {
  const graph = {
    nodes: [file("a.ts"), file("b.ts")],
    edges: [
      { id: "e1", from: "a.ts", to: "b.ts" },
      { id: "e1b", from: "a.ts", to: "b.ts" },
      { id: "x", from: "a.ts", to: "b.ts" },
      { id: "x::s", from: "a.ts", to: "b.ts" },
    ],
  };
  const data = await prepareRenderData(graph, [{ name: "r", fileIds: ["a.ts", "b.ts"] }], null, []);
  const edges = data.fileViewByFolder["r"].edges;
  assert.equal(edges.length, 4);
  for (const edge of edges) assert.ok(edge.route && edge.anchor, `${edge.id} routed`);
  assert.equal(new Set(edges.map((e) => e.route!.at(-1)!.y)).size, 4, "four distinct arrival points");
  assert.equal(new Set(edges.map((e) => e.anchor!.source)).size, 4, "four distinct departure anchors");
});

test("when ELK fails with per-edge ports, edges carry neither route nor anchor", async () => {
  const graph = {
    nodes: [file("a.ts"), file("b.ts")],
    edges: [
      { id: "a-b", from: "a.ts", to: "b.ts" },
      { id: "a-ghost", from: "a.ts", to: "ghost.ts" },
    ],
  };
  const data = await prepareRenderData(graph, [{ name: "r", fileIds: ["a.ts", "b.ts", "ghost.ts"] }], null, []);
  for (const edge of data.fileViewByFolder["r"].edges) {
    assert.equal(edge.route, undefined);
    assert.equal(edge.anchor, undefined);
  }
});
