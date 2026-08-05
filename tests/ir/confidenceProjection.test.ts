/**
 * Phase 0 Acceptance — Confidence Projection Fidelity
 *
 * The acceptance condition for Phase 0 is that every node and edge rendered
 * client-side carries the correct origin/confidence value when compared
 * against `repositoryIR` DIRECTLY — not merely against `renderData`, which
 * would be circular (renderData is the thing under test).
 *
 * These tests therefore always assert renderData against the IR, or against
 * ground truth constructed independently of the projection code.
 *
 * @module tests/ir/confidenceProjection.test
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
import {
  projectConfidenceByPath,
  edgeConfidenceFromSource,
} from "@/lib/analysis/projectConfidence";
import type {
  ExternalDependencyNode,
  FileNode,
  RepositoryIR,
} from "@/lib/analysis/ir/types";
import type { RenderNodeData } from "@/types/graph";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * A small repository exercising all three import outcomes:
 *   - resolvable internal import   → verified file, derived edge
 *   - genuine external package     → ExternalDependencyNode
 *   - broken relative import       → UnresolvedImportNode (the Phase 0 fix)
 */
async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-phase0-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fx" }));
  await mkdir(path.join(dir, "src"), { recursive: true });

  await writeFile(
    path.join(dir, "src", "index.ts"),
    [
      `import { helper } from "./helper";`,
      `import * as React from "react";`,
      `import { gone } from "./does-not-exist";`,
      `export const run = () => helper(React, gone);`,
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "src", "helper.ts"),
    `export const helper = (...args: unknown[]) => args.length;\n`,
  );
  return dir;
}

type Analyzed = {
  ir: RepositoryIR;
  renderData: Awaited<ReturnType<typeof prepareRenderData>>;
  graph: ReturnType<typeof buildGraph>;
};

async function analyze(dir: string): Promise<Analyzed> {
  const registry = new ParserRegistry();
  registry.register(new TypeScriptParser());
  const discovered = [
    { absolutePath: path.join(dir, "src", "index.ts"), relativePath: "src/index.ts" },
    { absolutePath: path.join(dir, "src", "helper.ts"), relativePath: "src/helper.ts" },
  ];
  await registry.initializeAll({ projectRoot: dir, discoveredFiles: discovered });
  const extraction = await extractAll(dir, discovered, registry);
  registry.disposeAll();

  const { files, parseErrors } = toLegacyResult(extraction);
  const graph = buildGraph(files);
  const clusters = clusterByFolder(graph);
  const ir = buildRepositoryIR(dir, extraction.extractions);
  assert.ok(ir, "IR construction must succeed for this fixture");
  const renderData = await prepareRenderData(graph, clusters, ir, parseErrors);
  return { ir, renderData, graph };
}

// ---------------------------------------------------------------------------
// The Phase 0 fix: unresolved imports survive the pipeline
// ---------------------------------------------------------------------------

/**
 * Exercises the preservation fix directly, from the shape a parser hands the
 * bridge. `unresolvedInternalImports` is populated by extractAll whenever a
 * parser reports unresolvedKind === 'unresolved-internal' (today: Python).
 * Constructing the RawExtraction here tests the bridge without requiring the
 * tree-sitter WASM runtime.
 */
test("Phase 0 — unresolved internal imports are preserved, not laundered", async (t) => {
  const dir = await makeFixture();
  try {
    const ir = buildRepositoryIR(dir, [
      {
        path: "pkg/app.py",
        lineCount: 12,
        internalImports: [],
        externalImports: ["os"],
        unresolvedInternalImports: ["pkg.missing"],
        parseErrors: [],
        capabilitiesUsed: ["imports"],
      },
      {
        path: "pkg/other.py",
        lineCount: 4,
        internalImports: [],
        externalImports: [],
        unresolvedInternalImports: ["pkg.missing"],
        parseErrors: [],
        capabilitiesUsed: ["imports"],
      },
    ]);
    assert.ok(ir, "IR construction must succeed");

    await t.test("an unresolvable internal import becomes an UnresolvedImport node", () => {
      const unresolved = ir!.nodes.filter((n) => n.kind === "UnresolvedImport");
      assert.ok(unresolved.length > 0, "expected UnresolvedImport nodes");
      assert.ok(
        unresolved.every((n) =>
          (n as { specifier: string }).specifier === "pkg.missing",
        ),
      );
    });

    await t.test("it is NOT represented as an external dependency", () => {
      // The regression this guards: unresolved internal imports used to be
      // built as ExternalDependencyNode, making `import "./missing"` and
      // `import "react"` byte-identical in the IR.
      const names = ir!.nodes
        .filter((n) => n.kind === "ExternalDependency")
        .map((n) => (n as { name: string }).name);
      assert.ok(
        !names.includes("pkg.missing"),
        `unresolved import leaked into external dependencies: ${names.join(", ")}`,
      );
    });

    await t.test("a genuine external import stays external, and is verified", () => {
      const os = ir!.nodes.find(
        (n): n is ExternalDependencyNode =>
          n.kind === "ExternalDependency" && n.name === "os",
      );
      assert.ok(os, "expected an ExternalDependency node for 'os'");
      assert.equal(os.provenance.origin, "verified");
    });

    await t.test("the same specifier in two files stays two distinct nodes", () => {
      // './missing' in a/x and './missing' in b/y denote different unknown
      // targets. Merging them would assert an identity we cannot support.
      const unresolved = ir!.nodes.filter((n) => n.kind === "UnresolvedImport");
      assert.equal(unresolved.length, 2);
      assert.notEqual(unresolved[0].id, unresolved[1].id);
    });

    await t.test("every unresolved import is reachable by an edge", () => {
      // Rendered as an absent edge, an unresolved import would be
      // indistinguishable from 'imports nothing'. It must be a real target.
      const unresolvedIds = new Set(
        ir!.nodes.filter((n) => n.kind === "UnresolvedImport").map((n) => n.id),
      );
      const targeted = new Set(
        ir!.edges.filter((e) => unresolvedIds.has(e.to)).map((e) => e.to),
      );
      assert.deepEqual([...targeted].sort(), [...unresolvedIds].sort());
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Phase 0.5 — the TypeScript/Python parity gap, now closed.
 *
 * Until Phase 0.5, the TypeScript parser never set unresolvedKind, so every
 * specifier it failed to resolve — including a plainly relative one like
 * './does-not-exist' — was classified as external before the bridge ever ran.
 * A repository presented different confidence semantics purely because of the
 * language it was written in.
 *
 * The TS resolver now classifies syntax-guaranteed-internal specifiers
 * ('./', '../', '/') that fail lookup as 'unresolved-internal', matching what
 * the Python resolver already did for relative imports. This test is the
 * inversion of the former known-gap test, and asserts the parity directly.
 *
 * Scope note: alias-shaped specifiers (e.g. '@/lib/gone') are still reported
 * as external, because a tsconfig `paths` entry may legitimately point into
 * node_modules — see resolveSpecifier in parsers/typescript/resolve.ts.
 */
test("Phase 0.5 — TypeScript broken relative imports are unresolved, not external", async (t) => {
  const dir = await makeFixture();
  try {
    const { ir } = await analyze(dir);

    await t.test("a broken relative import becomes an UnresolvedImport node", () => {
      const unresolved = ir.nodes.filter((n) => n.kind === "UnresolvedImport");
      assert.equal(unresolved.length, 1);
      assert.equal(
        (unresolved[0] as { specifier: string }).specifier,
        "./does-not-exist",
      );
    });

    await t.test("it does NOT appear as an external dependency", () => {
      const names = ir.nodes
        .filter((n) => n.kind === "ExternalDependency")
        .map((n) => (n as { name: string }).name);
      assert.ok(
        !names.some((name) => name.includes("does-not-exist")),
        `unresolved import leaked into external dependencies: ${names.join(", ")}`,
      );
    });

    await t.test("the unresolved import is reachable by an edge", () => {
      // Rendered as an absent edge it would be indistinguishable from
      // 'imports nothing'. It must be a real edge target.
      const unresolvedIds = new Set(
        ir.nodes.filter((n) => n.kind === "UnresolvedImport").map((n) => n.id),
      );
      const targeted = new Set(
        ir.edges.filter((e) => unresolvedIds.has(e.to)).map((e) => e.to),
      );
      assert.deepEqual([...targeted].sort(), [...unresolvedIds].sort());
    });

    await t.test("a real package is external and verified", () => {
      const react = ir.nodes.find(
        (n): n is ExternalDependencyNode =>
          n.kind === "ExternalDependency" && n.name === "react",
      );
      assert.ok(react, "expected an ExternalDependency node for 'react'");
      assert.equal(react.provenance.origin, "verified");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Acceptance: renderData confidence agrees with the IR, node by node
// ---------------------------------------------------------------------------

test("Phase 0 acceptance — render confidence matches the IR directly", async (t) => {
  const dir = await makeFixture();
  try {
    const { ir, renderData } = await analyze(dir);

    // Ground truth read straight off the IR, independent of the projection.
    const irConfidenceByPath = new Map<string, "precise" | "heuristic">();
    for (const node of ir.nodes) {
      if (node.kind === "File") {
        const file = node as FileNode;
        irConfidenceByPath.set(file.path, file.confidence);
      }
    }
    assert.ok(irConfidenceByPath.size > 0, "fixture must produce file nodes");

    await t.test("every rendered file node carries confidence from the IR", () => {
      let checked = 0;
      for (const graph of Object.values(renderData.fileViewByFolder)) {
        for (const node of graph.nodes) {
          const data = node.data as RenderNodeData;
          if (data.kind !== "file") continue;
          const irValue = irConfidenceByPath.get(data.filePath!);
          assert.ok(
            irValue !== undefined,
            `rendered file ${data.filePath} has no corresponding IR FileNode`,
          );
          const expected = irValue === "heuristic" ? "heuristic" : "verified";
          assert.equal(
            data.confidence,
            expected,
            `confidence mismatch for ${data.filePath}`,
          );
          checked++;
        }
      }
      assert.ok(checked > 0, "expected at least one rendered file node");
    });

    await t.test("every rendered node has a confidence value at all", () => {
      const all = [
        ...renderData.folderView.nodes,
        ...Object.values(renderData.fileViewByFolder).flatMap((g) => g.nodes),
      ];
      for (const node of all) {
        const data = node.data as RenderNodeData;
        assert.ok(
          data.confidence,
          `node ${node.id} is missing confidence entirely`,
        );
      }
    });

    await t.test("folder nodes are derived, never inheriting file uncertainty", () => {
      // Containment is a deterministic computation over verified facts. A
      // region containing an uncertain file is not itself uncertain.
      for (const node of renderData.folderView.nodes) {
        assert.equal((node.data as RenderNodeData).confidence, "derived");
      }
    });

    await t.test("edges carry confidence propagated from their source file", () => {
      // Three edge kinds now appear in a file view:
      //   file → file    confidence follows the SOURCE file (Phase 0)
      //   file → unresolved stub
      //                  always 'unknown' — the target is undetermined,
      //                  regardless of how well the source file was read
      //   file ↔ boundary stub (Phase 2)
      //                  confidence follows the source FILE, even when the
      //                  stub is the edge's source. A collapsed target is
      //                  fully known; collapsing changes what is drawn, never
      //                  how well the relationship is known.
      const nodesByView = Object.values(renderData.fileViewByFolder).flatMap(
        (g) => g.nodes,
      );
      const unresolvedIds = new Set(
        nodesByView
          .filter((n) => (n.data as RenderNodeData).kind === "unresolved")
          .map((n) => n.id),
      );
      const boundaryIds = new Set(
        nodesByView
          .filter((n) => (n.data as RenderNodeData).isBoundary)
          .map((n) => n.id),
      );

      for (const graph of Object.values(renderData.fileViewByFolder)) {
        for (const edge of graph.edges) {
          assert.ok(edge.confidence, `edge ${edge.id} is missing confidence`);

          if (unresolvedIds.has(edge.target)) {
            assert.equal(
              edge.confidence,
              "unknown",
              `edge to unresolved stub ${edge.id} must be unknown`,
            );
            continue;
          }

          // A boundary edge is never 'unknown' — that would claim ignorance
          // about a target we have fully verified.
          if (boundaryIds.has(edge.source) || boundaryIds.has(edge.target)) {
            assert.notEqual(
              edge.confidence,
              "unknown",
              `boundary edge ${edge.id} must not read as unknown`,
            );
            continue;
          }

          const sourceIr = irConfidenceByPath.get(edge.source);
          const expected = sourceIr === "heuristic" ? "heuristic" : "derived";
          assert.equal(edge.confidence, expected, `edge ${edge.id}`);
        }
      }
    });

    await t.test("no rendered element claims 'assisted'", () => {
      // Nothing generates interpretation yet. If this ever fails, generated
      // content has reached graph geometry, which the encoding forbids.
      const all = [
        ...renderData.folderView.nodes,
        ...Object.values(renderData.fileViewByFolder).flatMap((g) => g.nodes),
      ];
      for (const node of all) {
        assert.notEqual((node.data as RenderNodeData).confidence, "assisted");
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Provenance propagation and the fallback path
// ---------------------------------------------------------------------------

test("Phase 0 — provenance never silently upgrades", async (t) => {
  await t.test("a heuristic source yields a heuristic edge", () => {
    assert.equal(edgeConfidenceFromSource("heuristic"), "heuristic");
  });

  await t.test("a verified source yields a derived edge", () => {
    // The edge is a deterministic consequence of the file's facts, so it is
    // 'derived' rather than 'verified' — it was computed, not witnessed.
    assert.equal(edgeConfidenceFromSource("verified"), "derived");
  });
});

test("Phase 0 — fallback when IR construction fails", async (t) => {
  await t.test("files with parse errors are heuristic, others verified", () => {
    const byPath = projectConfidenceByPath(
      null,
      ["a.ts", "b.ts"],
      [{ filePath: "b.ts", message: "syntax error" }],
    );
    assert.equal(byPath.get("a.ts"), "verified");
    assert.equal(byPath.get("b.ts"), "heuristic");
  });

  await t.test("failure does not render everything as unknown", () => {
    // The structure was still observed; only the provenance record was lost.
    // Marking it all unknown would be a false statement about the code.
    const byPath = projectConfidenceByPath(null, ["a.ts"], []);
    assert.notEqual(byPath.get("a.ts"), "unknown");
  });
});
