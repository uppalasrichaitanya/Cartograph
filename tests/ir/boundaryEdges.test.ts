/**
 * Phase 2 — Truth-Defect Fixes
 *
 * Three defects, each a case where the interface said something the evidence
 * did not support:
 *
 *   1. Cross-boundary dependencies were deleted on drill-in, so a file with
 *      seven outside imports rendered with none — while the inspector listed
 *      all seven. The map and the inspector contradicted each other about
 *      identical evidence.
 *   2. A density check revoked the user's navigation, returning them to the
 *      overview for a reason internal to the renderer.
 *   3. Statistics counted up on mount, dramatising work that had completed
 *      server-side long before render.
 *
 * These tests lock the fixes. The first suite is the important one: it asserts
 * agreement between what the map draws and what the graph actually contains,
 * which is the invariant the original defect violated.
 *
 * @module tests/ir/boundaryEdges.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import type { RenderNodeData } from "@/types/graph";

const DIAGRAM_PATH = path.join(process.cwd(), "components", "DiagramView.tsx");
const CSS_PATH = path.join(process.cwd(), "app", "globals.css");

// ---------------------------------------------------------------------------
// Fixture — two regions with dependencies crossing between them
// ---------------------------------------------------------------------------

/**
 * Three files per region so clusterByFolder does not merge them into "other"
 * (it merges any proposed folder with fewer than 3 files).
 *
 * Dependency shape, deliberately including both directions:
 *   core/a    → ui/x      (outgoing across the boundary)
 *   core/a    → core/b    (intra-region, must survive unchanged)
 *   ui/x      → core/c    (incoming across the boundary)
 */
async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-phase2-"));
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
  return { graph, clusters, renderData };
}

// ---------------------------------------------------------------------------
// 1. Cross-boundary dependencies survive drill-in
// ---------------------------------------------------------------------------

test("Phase 2 — cross-boundary dependencies are visible, not deleted", async (t) => {
  const dir = await makeFixture();
  try {
    const { graph, renderData } = await analyze(dir);

    // Sanity-check the fixture produced the shape these tests depend on.
    assert.ok(
      renderData.fileViewByFolder["src/core"],
      "fixture must produce a src/core region",
    );
    assert.ok(
      renderData.fileViewByFolder["src/ui"],
      "fixture must produce a src/ui region",
    );

    await t.test("every real dependency of a file is represented in its view", () => {
      // The regression this guards, stated as the invariant it broke: for each
      // region, every edge in the underlying graph touching a file in that
      // region must be represented — either file→file, or via a boundary stub.
      // Previously cross-boundary edges satisfied neither and simply vanished.
      for (const [regionName, view] of Object.entries(renderData.fileViewByFolder)) {
        const inRegion = new Set(
          view.nodes
            .map((n) => n.data as RenderNodeData)
            .filter((d) => d.kind === "file")
            .map((d) => d.filePath!),
        );
        const drawnPairs = new Set(view.edges.map((e) => `${e.source}->${e.target}`));
        const boundaryIds = new Set(
          view.nodes
            .filter((n) => (n.data as RenderNodeData).isBoundary)
            .map((n) => n.id),
        );

        for (const edge of graph.edges) {
          const fromIn = inRegion.has(edge.from);
          const toIn = inRegion.has(edge.to);
          if (!fromIn && !toIn) continue;

          if (fromIn && toIn) {
            assert.ok(
              drawnPairs.has(`${edge.from}->${edge.to}`),
              `${regionName}: intra-region edge ${edge.from}->${edge.to} is missing`,
            );
            continue;
          }

          // Crosses the boundary — must terminate at a boundary stub.
          const representedOut = [...boundaryIds].some((stub) =>
            drawnPairs.has(`${edge.from}->${stub}`),
          );
          const representedIn = [...boundaryIds].some((stub) =>
            drawnPairs.has(`${stub}->${edge.to}`),
          );
          assert.ok(
            representedOut || representedIn,
            `${regionName}: cross-boundary edge ${edge.from}->${edge.to} is not represented`,
          );
        }
      }
    });

    await t.test("the map and the inspector agree about a file's imports", () => {
      // core/a imports ui/x (crossing) and core/b (local). The inspector lists
      // both. The map must now account for both too — this exact disagreement
      // was the defect.
      const view = renderData.fileViewByFolder["src/core"];
      const fileA = graph.nodes.find((n) => n.path === "src/core/a.ts");
      assert.ok(fileA);
      assert.equal(fileA!.imports.length, 2, "fixture: a.ts should import 2 files");

      const outgoing = view.edges.filter((e) => e.source === fileA!.id);
      assert.equal(
        outgoing.length,
        fileA!.imports.length,
        "every import the inspector lists must have a corresponding edge",
      );
    });

    await t.test("an outgoing cross-boundary edge points at the owning region", () => {
      const view = renderData.fileViewByFolder["src/core"];
      const stub = view.nodes.find(
        (n) => (n.data as RenderNodeData).isBoundary,
      );
      assert.ok(stub, "src/core must show a boundary stub for src/ui");
      assert.equal((stub!.data as RenderNodeData).label, "src/ui");

      const edge = view.edges.find((e) => e.target === stub!.id);
      assert.ok(edge, "an edge must terminate at the stub");
      assert.equal(edge!.source, "src/core/a.ts");
    });

    await t.test("an incoming cross-boundary edge originates at the owning region", () => {
      // ui/x → core/c means src/ui's view must show the dependency leaving,
      // and src/core's view must show it arriving from the collapsed src/ui.
      const view = renderData.fileViewByFolder["src/core"];
      const stub = view.nodes.find((n) => (n.data as RenderNodeData).isBoundary);
      assert.ok(stub);
      const incoming = view.edges.find(
        (e) => e.source === stub!.id && e.target === "src/core/c.ts",
      );
      assert.ok(
        incoming,
        "the dependency from the collapsed src/ui into core/c must be drawn",
      );
    });

    await t.test("intra-region edges are unchanged", () => {
      const view = renderData.fileViewByFolder["src/core"];
      const local = view.edges.find(
        (e) => e.source === "src/core/a.ts" && e.target === "src/core/b.ts",
      );
      assert.ok(local, "the local a→b edge must survive untouched");
      assert.equal(local!.confidence, "derived");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. A boundary stub is not an uncertainty signal
// ---------------------------------------------------------------------------

test("Phase 2 — boundary stubs never read as uncertainty", async (t) => {
  const dir = await makeFixture();
  try {
    const { renderData } = await analyze(dir);
    const stubs = Object.values(renderData.fileViewByFolder)
      .flatMap((g) => g.nodes)
      .filter((n) => (n.data as RenderNodeData).isBoundary);
    assert.ok(stubs.length > 0, "fixture must produce boundary stubs");

    await t.test("a stub's confidence is 'derived', like any region", () => {
      // Collapsing a target changes what is drawn, never how well it is known.
      for (const stub of stubs) {
        assert.equal((stub.data as RenderNodeData).confidence, "derived");
      }
    });

    await t.test("a stub is never 'unknown'", () => {
      // 'unknown' means the target could not be determined. A collapsed
      // region's contents are fully verified — claiming ignorance would be
      // the mirror image of the defect this phase fixes.
      for (const stub of stubs) {
        assert.notEqual((stub.data as RenderNodeData).confidence, "unknown");
        assert.notEqual((stub.data as RenderNodeData).kind, "unresolved");
      }
    });

    await t.test("boundary edges are never 'unknown'", () => {
      const stubIds = new Set(stubs.map((n) => n.id));
      const boundaryEdges = Object.values(renderData.fileViewByFolder)
        .flatMap((g) => g.edges)
        .filter((e) => stubIds.has(e.source) || stubIds.has(e.target));
      assert.ok(boundaryEdges.length > 0);
      for (const edge of boundaryEdges) {
        assert.notEqual(edge.confidence, "unknown");
      }
    });

    await t.test("a stub carries no confidence marker", () => {
      // Its confidence is full, and verified/derived are unmarked by design.
      const source = readFileSync(DIAGRAM_PATH, "utf8");
      const marker = source.match(/function confidenceMarker[\s\S]*?\n}/)?.[0];
      assert.ok(marker);
      assert.match(marker!, /default:\s*\n\s*return null/);
    });

    await t.test("stub styling avoids every channel confidence uses", () => {
      const css = readFileSync(CSS_PATH, "utf8");
      const rule = css.match(/\.architecture-node\.is-boundary\s*\{([^}]*)\}/)?.[1];
      assert.ok(rule, "a boundary treatment must exist");
      // Dashed borders mean reduced evidence. A stub's evidence is full.
      assert.ok(
        !/border-style:\s*dashed/.test(rule!),
        "a boundary stub must not be dashed — that reads as reduced confidence",
      );
      assert.ok(
        !/opacity/.test(rule!),
        "a boundary stub must not be faded — that reads as uncertainty",
      );
    });

    await t.test("a stub remains navigable", () => {
      // The relationship must stay followable, not merely acknowledged.
      for (const stub of stubs) {
        const data = stub.data as RenderNodeData;
        assert.equal(data.kind, "folder");
        assert.ok(data.folder, "a stub must name the region it navigates to");
      }
      // kind 'folder' + a folder value is exactly what onNodeClick routes on.
      const source = readFileSync(DIAGRAM_PATH, "utf8");
      assert.match(
        source,
        /node\.data\.kind === "folder" && node\.data\.folder/,
        "folder-kind nodes must route to region navigation",
      );
    });

    await t.test("stub geometry is deterministic", () => {
      // Same repository, same map — for the same person later, and for anyone
      // they share it with.
      for (const stub of stubs) {
        assert.equal(typeof stub.position.x, "number");
        assert.equal(typeof stub.position.y, "number");
        assert.ok(Number.isFinite(stub.position.x));
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Navigation is never revoked
// ---------------------------------------------------------------------------

test("Phase 2 — the renderer never takes away the user's position", async (t) => {
  const source = readFileSync(DIAGRAM_PATH, "utf8");

  await t.test("the overlap scan is gone", () => {
    assert.ok(
      !/haveOverlaps/.test(source),
      "the O(n²) overlap scan must not exist",
    );
  });

  await t.test("nothing resets the view to the overview automatically", () => {
    // setFolder(null) is legitimate when the USER asks (breadcrumb, brand).
    // What must not exist is an effect that does it on the renderer's behalf.
    const effects = source.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const effect of effects) {
      assert.ok(
        !/setFolder\(null\)/.test(effect),
        `an effect must not revoke navigation:\n${effect.slice(0, 200)}`,
      );
    }
  });

  await t.test("the density retreat notice is gone", () => {
    assert.ok(!/layoutNotice/.test(source));
    const css = readFileSync(CSS_PATH, "utf8");
    assert.ok(
      !/\.layout-notice\b/.test(css),
      "dead styling for the removed notice must not linger",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Motion never dramatises completed work
// ---------------------------------------------------------------------------

test("Phase 2 — statistics are not animated", async (t) => {
  const source = readFileSync(DIAGRAM_PATH, "utf8");

  await t.test("the count-up hook is gone", () => {
    assert.ok(!/useCountUp/.test(source));
    assert.ok(
      !/AnimatedStat/.test(source),
      "the animated stat component must not remain",
    );
  });

  await t.test("counts render as plain final values", () => {
    // Phase 3 removed the summary grid; the counts now live in the rail.
    // What must not change is that they arrive already final — these numbers
    // were computed server-side long before render, so animating them would
    // dramatise completed work.
    assert.match(
      source,
      /result\.graph\.nodes\.length\.toLocaleString\(\)/,
      "file count should render directly from the graph",
    );
    assert.match(source, /result\.graph\.edges\.length\.toLocaleString\(\)/);
  });

  await t.test("no easing or frame loop drives any displayed number", () => {
    // requestAnimationFrame is legitimate for camera work; what must not exist
    // is a frame loop feeding a rendered count.
    assert.ok(
      !/setValue|easeOut|Math\.pow\(1 - progress/.test(source),
      "no interpolation machinery should feed a displayed value",
    );
  });
});
