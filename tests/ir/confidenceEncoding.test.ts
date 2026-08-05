/**
 * Phase 1 — Confidence Encoding
 *
 * These tests lock the invariants of the five-state encoding. Each one exists
 * because breaking it would be easy, would look reasonable in a diff, and
 * would quietly weaken the product's central epistemic commitment.
 *
 * What is deliberately NOT tested here: exact colours, border widths, and
 * pixel values. Those are visual-design decisions that should be free to
 * change. What is tested is the structure the encoding depends on — that
 * verified is unmarked, that reduced states carry more than one channel, that
 * unknown is rendered rather than omitted, and that generated interpretation
 * cannot become geometry.
 *
 * @module tests/ir/confidenceEncoding.test
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
import {
  collectUnresolvedImports,
  fileEvidence,
} from "@/lib/analysis/projectConfidence";
import type { RenderNodeData } from "@/types/graph";

const CSS_PATH = path.join(process.cwd(), "app", "globals.css");
const NODE_COMPONENT_PATH = path.join(process.cwd(), "components", "DiagramView.tsx");

// ---------------------------------------------------------------------------
// Fixture — a repository containing a genuinely broken internal import
// ---------------------------------------------------------------------------

async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-phase1-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fx" }));
  await mkdir(path.join(dir, "src"), { recursive: true });

  await writeFile(
    path.join(dir, "src", "index.ts"),
    [
      `import { helper } from "./helper";`,
      `import * as React from "react";`,
      `import { gone } from "./does-not-exist";`,
      `import { alsoGone } from "../outside/missing";`,
      `export const run = () => helper(React, gone, alsoGone);`,
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "src", "helper.ts"),
    `export const helper = (...args: unknown[]) => args.length;\n`,
  );
  return dir;
}

async function analyze(dir: string) {
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
  assert.ok(ir, "IR construction must succeed");
  const renderData = await prepareRenderData(graph, clusters, ir, parseErrors);
  return { ir, renderData };
}

function allRenderNodes(
  renderData: Awaited<ReturnType<typeof prepareRenderData>>,
) {
  return [
    ...renderData.folderView.nodes,
    ...Object.values(renderData.fileViewByFolder).flatMap((g) => g.nodes),
  ];
}

// ---------------------------------------------------------------------------
// Unknown is rendered, never omitted
// ---------------------------------------------------------------------------

test("Phase 1 — unknown is visible geometry, not absence", async (t) => {
  const dir = await makeFixture();
  try {
    const { ir, renderData } = await analyze(dir);

    await t.test("each unresolved import becomes its own stub node", () => {
      // One stub per (file, specifier) — matching how the IR models them.
      const irUnresolved = ir.nodes.filter((n) => n.kind === "UnresolvedImport");
      assert.equal(irUnresolved.length, 2, "fixture should have 2 broken imports");

      const stubs = allRenderNodes(renderData).filter(
        (n) => (n.data as RenderNodeData).kind === "unresolved",
      );
      assert.equal(
        stubs.length,
        irUnresolved.length,
        "every unresolved import in the IR must appear as a stub",
      );
    });

    await t.test("every stub carries confidence 'unknown'", () => {
      const stubs = allRenderNodes(renderData).filter(
        (n) => (n.data as RenderNodeData).kind === "unresolved",
      );
      for (const stub of stubs) {
        assert.equal((stub.data as RenderNodeData).confidence, "unknown");
      }
    });

    await t.test("a stub names the specifier as written in source", () => {
      const stubs = allRenderNodes(renderData)
        .map((n) => n.data as RenderNodeData)
        .filter((d) => d.kind === "unresolved");
      const specifiers = stubs.map((d) => d.specifier).sort();
      assert.deepEqual(specifiers, ["../outside/missing", "./does-not-exist"]);
    });

    await t.test("a stub records which file referenced it", () => {
      // Identity is per (file, specifier): the same specifier in two files
      // denotes two different unknown targets.
      const stubs = allRenderNodes(renderData)
        .map((n) => n.data as RenderNodeData)
        .filter((d) => d.kind === "unresolved");
      for (const stub of stubs) {
        assert.equal(stub.referencedBy, "src/index.ts");
      }
    });

    await t.test("each stub is reachable by an edge from its file", () => {
      // The whole point: a file with a broken import must NOT look like a
      // file that imports nothing.
      const fileGraphs = Object.values(renderData.fileViewByFolder);
      const stubIds = new Set(
        fileGraphs
          .flatMap((g) => g.nodes)
          .filter((n) => (n.data as RenderNodeData).kind === "unresolved")
          .map((n) => n.id),
      );
      const targeted = new Set(
        fileGraphs
          .flatMap((g) => g.edges)
          .filter((e) => stubIds.has(e.target))
          .map((e) => e.target),
      );
      assert.deepEqual([...targeted].sort(), [...stubIds].sort());
    });

    await t.test("stub layout is deterministic across runs", () => {
      // Stable geometry is a continuity commitment: the same repository must
      // produce the same map for the same person later, and for anyone they
      // share it with.
      const specifiers = collectUnresolvedImports(ir).get("src/index.ts") ?? [];
      assert.deepEqual(
        specifiers.map((r) => r.specifier),
        ["../outside/missing", "./does-not-exist"],
        "unresolved imports must be returned in stable sorted order",
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Verified carries no marker
// ---------------------------------------------------------------------------

test("Phase 1 — verified and derived are unmarked", async (t) => {
  const source = readFileSync(NODE_COMPONENT_PATH, "utf8");

  await t.test("confidenceMarker returns nothing for verified or derived", () => {
    // Marking the common case would make the mark wallpaper. Absence of a
    // marker IS the signal for full confidence.
    const marker = source.match(
      /function confidenceMarker[\s\S]*?\n}/,
    )?.[0];
    assert.ok(marker, "confidenceMarker function should exist");
    assert.ok(
      !/case "verified"/.test(marker) && !/case "derived"/.test(marker),
      "verified and derived must fall through to the null default",
    );
    assert.match(marker, /default:\s*\n\s*return null/);
  });

  await t.test("no CSS rule styles the verified state", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    assert.ok(
      !/\.confidence-verified\b/.test(css),
      "verified must have no visual treatment of its own",
    );
  });

  await t.test("derived is unstyled in the map", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    // Derived is equally reliable as verified; giving it distinct visual
    // authority in the map would misrepresent that. Lineage lives in the
    // inspector instead.
    assert.ok(
      !/\.architecture-node\.confidence-derived\b/.test(css),
      "derived nodes must render identically to verified",
    );
  });
});

// ---------------------------------------------------------------------------
// Every reduced state uses at least two perceptual channels
// ---------------------------------------------------------------------------

test("Phase 1 — reduced states never depend on colour alone", async (t) => {
  const css = readFileSync(CSS_PATH, "utf8");

  const ruleFor = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `expected a CSS rule for ${selector}`);
    return match![1];
  };

  await t.test("heuristic nodes change border style, not just colour", () => {
    const rule = ruleFor(".architecture-node.confidence-heuristic");
    assert.match(rule, /border-style:\s*dashed/);
  });

  await t.test("unknown nodes change shape, not just colour", () => {
    const rule = ruleFor(".architecture-node.confidence-unknown");
    assert.match(rule, /border-style:\s*dashed/);
    // The shape does not close — it reads as continuing into something that
    // cannot be shown.
    assert.match(rule, /border-right:\s*none/);
  });

  await t.test("heuristic edges are dashed", () => {
    const rule = ruleFor(".react-flow__edge.confidence-heuristic .react-flow__edge-path");
    assert.match(rule, /stroke-dasharray/);
  });

  await t.test("unknown edges are dashed", () => {
    const rule = ruleFor(".react-flow__edge.confidence-unknown .react-flow__edge-path");
    assert.match(rule, /stroke-dasharray/);
  });

  await t.test("both reduced states also carry a word marker", () => {
    const source = readFileSync(NODE_COMPONENT_PATH, "utf8");
    const marker = source.match(/function confidenceMarker[\s\S]*?\n}/)?.[0];
    assert.ok(marker);
    assert.match(marker!, /case "heuristic"/);
    assert.match(marker!, /case "unknown"/);
  });

  await t.test("no confidence state is animated", () => {
    // A moving dash would spend continuous attention on a static fact and
    // imply activity that is not occurring.
    for (const selector of [
      ".react-flow__edge.confidence-heuristic .react-flow__edge-path",
      ".react-flow__edge.confidence-unknown .react-flow__edge-path",
      ".architecture-node.confidence-heuristic",
      ".architecture-node.confidence-unknown",
    ]) {
      const rule = ruleFor(selector);
      assert.ok(
        !/animation/.test(rule),
        `${selector} must not animate`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Uncertainty is quieter, never louder
// ---------------------------------------------------------------------------

test("Phase 1 — reduced evidence is visually quieter", async (t) => {
  const css = readFileSync(CSS_PATH, "utf8");

  await t.test("unknown nodes carry no shadow", () => {
    const rule = css.match(
      /\.architecture-node\.confidence-unknown\s*\{([^}]*)\}/,
    )?.[1];
    assert.ok(rule);
    assert.match(rule!, /box-shadow:\s*none/);
  });

  await t.test("unknown nodes do not lift on hover", () => {
    const rule = css.match(
      /\.architecture-node\.confidence-unknown:hover\s*\{([^}]*)\}/,
    )?.[1];
    assert.ok(rule);
    assert.match(rule!, /transform:\s*none/);
  });

  await t.test("the marker is small and unfilled", () => {
    const rule = css.match(/\.confidence-marker\s*\{([^}]*)\}/)?.[1];
    assert.ok(rule);
    assert.ok(!/background/.test(rule!), "marker must not be a filled badge");
  });

  await t.test("no amber or red is used for confidence", () => {
    // The old warning treatment coloured low confidence like an alarm. Amber
    // and red belong to genuine failure, not to honest uncertainty.
    const confidenceRules =
      css.match(/\.confidence-[a-z-]+[^{]*\{[^}]*\}/g)?.join("\n") ?? "";
    assert.ok(confidenceRules.length > 0);
    for (const forbidden of ["#e6a13d", "#e99322", "#f59e0b", "#d92d20", "#b42318"]) {
      assert.ok(
        !confidenceRules.includes(forbidden),
        `confidence styling must not use alarm colour ${forbidden}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Assisted can never become geometry
// ---------------------------------------------------------------------------

test("Phase 1 — assisted is architecturally separated", async (t) => {
  await t.test("GeometryConfidence excludes 'assisted' at the type level", () => {
    const types = readFileSync(
      path.join(process.cwd(), "types", "graph.ts"),
      "utf8",
    );
    assert.match(
      types,
      /GeometryConfidence\s*=\s*Exclude<RenderConfidence,\s*"assisted">/,
      "the exclusion must be enforced by the compiler, not by convention",
    );
  });

  await t.test("no node or edge can be assisted", async () => {
    const dir = await makeFixture();
    try {
      const { renderData } = await analyze(dir);
      for (const node of allRenderNodes(renderData)) {
        assert.notEqual((node.data as RenderNodeData).confidence, "assisted");
      }
      const edges = Object.values(renderData.fileViewByFolder).flatMap(
        (g) => g.edges,
      );
      for (const edge of edges) {
        assert.notEqual(edge.confidence, "assisted");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test("the assisted surface is visually unlike every fact surface", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    const rule = css.match(/\.assisted-note\s*\{([^}]*)\}/)?.[1];
    assert.ok(rule, "an assisted surface must exist before the first AI feature");
    // Its own ground and a left rule — not a node, not a card.
    assert.match(rule!, /border-left/);

    const body = css.match(/\.assisted-note p\s*\{([^}]*)\}/)?.[1];
    assert.ok(body);
    assert.match(body!, /font-style:\s*italic/);
    assert.match(body!, /serif/);
  });

  await t.test("the assisted surface is always labelled", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    const label = css.match(/\.assisted-note \.assisted-label\s*\{([^}]*)\}/)?.[1];
    assert.ok(label, "generated content must always carry its label");
    assert.match(label!, /text-transform:\s*uppercase/);
  });
});

// ---------------------------------------------------------------------------
// Inspector evidence
// ---------------------------------------------------------------------------

test("Phase 1 — the inspector explains reduced confidence", async (t) => {
  const dir = await makeFixture();
  try {
    const { ir } = await analyze(dir);

    await t.test("a cleanly parsed file reports no reasons", () => {
      const evidence = fileEvidence(ir, "src/helper.ts");
      assert.ok(evidence);
      assert.equal(evidence!.confidence, "verified");
      assert.deepEqual(evidence!.reducedBecause, []);
    });

    await t.test("unresolved specifiers are listed for the referencing file", () => {
      const evidence = fileEvidence(ir, "src/index.ts");
      assert.ok(evidence);
      assert.deepEqual(
        [...evidence!.unresolvedImports].sort(),
        ["../outside/missing", "./does-not-exist"],
      );
    });

    await t.test("no evidence record is distinguishable from a clean record", () => {
      // Without an IR we have no record of what failed. That is not the same
      // as asserting nothing failed, so the answer is null, not an empty
      // record the panel would render as reassurance.
      assert.equal(fileEvidence(null, "src/index.ts"), null);
      assert.equal(fileEvidence(ir, "src/nonexistent.ts"), null);
    });

    await t.test("cause wording names the cause without assigning blame", () => {
      const source = readFileSync(
        path.join(process.cwd(), "lib", "analysis", "projectConfidence.ts"),
        "utf8",
      );
      const describe = source.match(
        /function describeParseError[\s\S]*?\n}/,
      )?.[0];
      assert.ok(describe);
      // Every reason produces plain prose, not a raw enum value.
      for (const reason of ["syntax", "timeout", "unreadable"]) {
        assert.match(describe!, new RegExp(`case "${reason}"`));
      }
      for (const blamed of ["invalid", "malformed", "bad ", "failed to"]) {
        assert.ok(
          !describe!.toLowerCase().includes(blamed),
          `cause wording should avoid blame language: "${blamed}"`,
        );
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
