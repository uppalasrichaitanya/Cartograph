/**
 * Phase 6 — Observations, reframed
 *
 * "God module" and "orphan" are verdicts wearing the clothes of measurement.
 * Each names a fault, and each is frequently wrong about one: a file
 * everything depends on may be excellent design, and a file nothing imports
 * may be an entry point doing exactly its job.
 *
 * Cartograph's responsibility is ensuring truthful conclusions remain
 * possible, not delivering them. These tests pin the vocabulary, the stated
 * basis for each measurement, and the absence of aggregate severity.
 *
 * @module tests/workspace/observations.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildGraph } from "@/lib/analysis/buildGraph";
import { clusterByFolder } from "@/lib/analysis/clusterByFolder";
import { detectAnomalies } from "@/lib/analysis/detectAnomalies";
import { LENS_VALUES, parsePosition } from "@/lib/workspace/position";

const DIAGRAM = readFileSync(
  path.join(process.cwd(), "components", "DiagramView.tsx"),
  "utf8",
);
const CSS = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

/** Source with comments stripped — absence assertions must read code, not the
 *  prose explaining why something was removed. */
const CODE = DIAGRAM.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

test("Phase 6 — lenses describe measurements", async (t) => {
  await t.test("each lens names what was measured", () => {
    assert.match(CODE, /label: "Most depended upon"/);
    assert.match(CODE, /label: "Not imported anywhere"/);
    assert.match(CODE, /label: "Import cycles"/);
  });

  await t.test("no lens states a verdict", () => {
    for (const verdict of ["God module", "godModule label", "Dependency hubs", "Orphans"]) {
      assert.ok(
        !new RegExp(verdict).test(CODE),
        `"${verdict}" asserts a conclusion the measurement does not support`,
      );
    }
  });

  await t.test("cycles keep their name", () => {
    // A cycle is provable structure, not an interpretation. Renaming it would
    // lose precision for no gain — the reframe targets verdicts, not accuracy.
    assert.match(CODE, /label: "Import cycles"/);
  });

  await t.test("each lens states its basis", () => {
    // The note is what turns a label into a description of evidence: a reader
    // can see what was counted and disagree with the conclusion.
    assert.match(CODE, /note: "Ranked by how many files import each\."/);
    assert.match(CODE, /note: "Entry points and CLI roots legitimately appear here\."/);
    assert.match(CODE, /note: "Files that import each other, directly or indirectly\."/);
  });

  await t.test("the hub count is shown, not just the ranking", () => {
    // Showing in-degree lets a reader check the ordering instead of trusting
    // it, and see whether "most depended upon" means 3 files or 30.
    assert.match(CODE, /\$\{mod\.filePath\} · \$\{mod\.inDegree\}/);
  });

  await t.test("the active-lens indicator matches the lens labels", () => {
    // The control and the indicator must not describe one lens two ways.
    assert.match(CODE, /hubs: "Most depended upon"/);
    assert.match(CODE, /orphans: "Not imported anywhere"/);
    assert.match(CODE, /cycles: "Import cycles"/);
  });

  await t.test("empty states report absence without implying virtue", () => {
    // "No cycles found" is a fact. "No problems!" would be a verdict, and the
    // reframe would be undone by its own empty state.
    assert.match(CODE, /empty: "Nothing stands out by import count\."/);
    assert.match(CODE, /empty: "Every file is imported by something\."/);
    assert.match(CODE, /empty: "No cycles found\."/);
  });
});

// ---------------------------------------------------------------------------
// The 'warnings' lens is gone
// ---------------------------------------------------------------------------

test("Phase 6 — nothing bundles observations under one verdict", async (t) => {
  await t.test("the warnings mode is removed from the type", () => {
    // It merged hubs, unimported files, and cycles into one set under a word
    // calling all three faults — the exact conflation this reframe undoes.
    const typeDecl = CODE.match(/type HighlightMode =[^;]+;/)?.[0];
    assert.ok(typeDecl);
    assert.ok(!/"warnings"/.test(typeDecl!));
  });

  await t.test("no code path computes a warnings set", () => {
    assert.ok(!/case "warnings"/.test(CODE));
  });

  await t.test("it is not a resolvable lens value", () => {
    assert.ok(!(LENS_VALUES as readonly string[]).includes("warnings"));
  });

  await t.test("a stale warnings link degrades to no lens", () => {
    // There is nothing left for it to resolve TO. Aliasing it to its old
    // behaviour would preserve the conflation the vocabulary changed to remove.
    const position = parsePosition(
      new URLSearchParams("?lens=warnings"),
      new Set(),
      new Set(),
    );
    assert.equal(position.lens, null);
  });

  await t.test("the remaining lenses still resolve", () => {
    for (const lens of ["cycles", "hubs", "orphans"]) {
      const position = parsePosition(
        new URLSearchParams(`?lens=${lens}`),
        new Set(),
        new Set(),
      );
      assert.equal(position.lens, lens);
    }
  });
});

// ---------------------------------------------------------------------------
// No aggregate severity
// ---------------------------------------------------------------------------

test("Phase 6 — observations are not summed into a severity figure", async (t) => {
  await t.test("the rail carries no total", () => {
    // Summing unlike measurements produced a number that read as severity. On
    // Cartograph's own source it would say "12", of which seven are Next.js
    // entry points and API routes doing exactly their job.
    assert.ok(!/observationTotal/.test(CODE));
    assert.ok(!/rail-button-count/.test(CODE));
  });

  await t.test("its styling is gone too", () => {
    assert.ok(!/\.rail-button-count\b/.test(CSS));
  });

  await t.test("per-lens counts remain", () => {
    // Each counts one measured thing and says what it measured.
    assert.match(CODE, /className="lens-item-count"/);
  });
});

// ---------------------------------------------------------------------------
// No alarm colouring
// ---------------------------------------------------------------------------

test("Phase 6 — observations are not coloured as alarms", async (t) => {
  const lensRules = CSS.match(/\.lens-[a-z-]+[^{]*\{[^}]*\}/g)?.join("\n") ?? "";

  await t.test("lens styling exists to check", () => {
    assert.ok(lensRules.length > 0);
  });

  await t.test("no amber or red appears in lens styling", () => {
    // Amber and red belong to genuine failure. An observation is not a fault,
    // and colouring it as one states a conclusion the measurement does not.
    for (const alarm of ["#e6a13d", "#e99322", "#f59e0b", "#d92d20", "#b42318", "amber"]) {
      assert.ok(
        !lensRules.includes(alarm),
        `lens styling must not use alarm colour ${alarm}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// A lens must be able to show what it counted
// ---------------------------------------------------------------------------

test("Phase 6 — a lens emphasises the regions holding its matches", async (t) => {
  // Found in rendered verification. Every observation names FILES, but the
  // region overview renders regions (`folder:lib`), so a file path matched
  // nothing there: a lens reporting nine unimported files dimmed every region
  // on screen, stating "none of these contain what you asked for" while all of
  // them did.
  //
  // A lens that reports a count must be able to show where those files are, or
  // it asserts something the map then contradicts.

  await t.test("matched files are lifted to their owning regions", () => {
    assert.match(
      CODE,
      /for \(const node of result\.graph\.nodes\) \{\s*\n\s*if \(files\.has\(node\.id\)\) ids\.add\(`folder:\$\{node\.folder\}`\);/,
      "the match set must include the regions containing matched files",
    );
  });

  await t.test("the file ids are kept alongside the regions", () => {
    // One set serves both views: file ids match directly in a file view, and
    // the region ids match in the overview.
    assert.match(CODE, /const ids = new Set\(files\)/);
  });

  await t.test("only regions holding a match are emphasised", () => {
    // Mirrors the case from rendered verification: unimported files live in
    // `app` and `lib`, so those two are emphasised and `components` recedes.
    //
    // Three files per folder, deliberately: clusterByFolder merges any folder
    // with fewer than three into a shared "other" bucket, which would collapse
    // the distinction this test is about.
    const graph = buildGraph([
      // Nothing imports app/*, so all three are unimported — entry points.
      { filePath: "app/page.tsx", lineCount: 1, imports: ["components/A.tsx"], externalImports: [] },
      { filePath: "app/layout.tsx", lineCount: 1, imports: ["lib/util.ts"], externalImports: [] },
      { filePath: "app/route.ts", lineCount: 1, imports: ["lib/util.ts"], externalImports: [] },
      // lib/entry.ts is unimported; the other two are imported.
      { filePath: "lib/util.ts", lineCount: 1, imports: ["lib/helper.ts"], externalImports: [] },
      { filePath: "lib/helper.ts", lineCount: 1, imports: [], externalImports: [] },
      { filePath: "lib/entry.ts", lineCount: 1, imports: ["lib/util.ts"], externalImports: [] },
      // Every components file is imported by something, so none match.
      { filePath: "components/A.tsx", lineCount: 1, imports: ["components/B.tsx"], externalImports: [] },
      { filePath: "components/B.tsx", lineCount: 1, imports: ["components/C.tsx"], externalImports: [] },
      { filePath: "components/C.tsx", lineCount: 1, imports: [], externalImports: [] },
    ]);
    clusterByFolder(graph);
    const unimported = new Set(detectAnomalies(graph).orphans);

    const regions = new Set<string>();
    for (const node of graph.nodes) {
      if (unimported.has(node.id)) regions.add(`folder:${node.folder}`);
    }

    assert.ok(regions.has("folder:app"), "app holds unimported entry points");
    assert.ok(regions.has("folder:lib"), "lib holds an unimported file");
    assert.ok(
      !regions.has("folder:components"),
      "components has no unimported files and must recede",
    );
  });
});

// ---------------------------------------------------------------------------
// The widened measurement
// ---------------------------------------------------------------------------

test("Phase 6 — 'not imported anywhere' means exactly that", async (t) => {
  await t.test("an entry point is reported", () => {
    // The measurement was in-degree 0 AND out-degree 0 — fully disconnected.
    // An entry point imports plenty, so it never appeared, even though
    // "nothing imports this" is precisely what is true of it.
    const graph = buildGraph([
      { filePath: "app/page.tsx", lineCount: 20, imports: ["lib/util.ts"], externalImports: [] },
      { filePath: "lib/util.ts", lineCount: 10, imports: [], externalImports: [] },
    ]);
    clusterByFolder(graph);
    assert.deepEqual(detectAnomalies(graph).orphans, ["app/page.tsx"]);
  });

  await t.test("a fully disconnected file is still reported", () => {
    const graph = buildGraph([
      { filePath: "src/a.ts", lineCount: 1, imports: ["src/b.ts"], externalImports: [] },
      { filePath: "src/b.ts", lineCount: 1, imports: [], externalImports: [] },
      { filePath: "src/lonely.ts", lineCount: 1, imports: [], externalImports: [] },
    ]);
    clusterByFolder(graph);
    assert.ok(detectAnomalies(graph).orphans.includes("src/lonely.ts"));
  });

  await t.test("an imported file is never reported", () => {
    const graph = buildGraph([
      { filePath: "src/main.ts", lineCount: 1, imports: ["src/lib.ts"], externalImports: [] },
      { filePath: "src/lib.ts", lineCount: 1, imports: [], externalImports: [] },
    ]);
    clusterByFolder(graph);
    assert.ok(!detectAnomalies(graph).orphans.includes("src/lib.ts"));
  });

  await t.test("out-degree does not affect the answer", () => {
    // Whether a file imports things is not evidence about whether it is
    // imported. Two unimported files must both appear regardless.
    const graph = buildGraph([
      { filePath: "a.ts", lineCount: 1, imports: ["shared.ts"], externalImports: [] },
      { filePath: "b.ts", lineCount: 1, imports: [], externalImports: [] },
      { filePath: "shared.ts", lineCount: 1, imports: [], externalImports: [] },
    ]);
    clusterByFolder(graph);
    assert.deepEqual(detectAnomalies(graph).orphans, ["a.ts", "b.ts"]);
  });
});
