import assert from "node:assert/strict";
import test from "node:test";
import { IRBuilder, languageFromPath } from "@/lib/analysis/ir/builder";
import { PathIndex } from "@/lib/analysis/ir/pathIndex";
import { IRValidationError } from "@/lib/analysis/ir/validation";
import type { RawExtraction } from "@/lib/analysis/ir/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function raw(overrides: Partial<RawExtraction> = {}): RawExtraction {
  return {
    path: "src/index.ts",
    lineCount: 10,
    internalImports: [],
    externalImports: [],
    parseErrors: [],
    capabilitiesUsed: ["imports"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// languageFromPath
// ---------------------------------------------------------------------------

test("languageFromPath", async (t) => {
  await t.test("detects TypeScript", () => {
    assert.equal(languageFromPath("src/index.ts"), "typescript");
    assert.equal(languageFromPath("components/App.tsx"), "typescript");
  });

  await t.test("detects JavaScript", () => {
    assert.equal(languageFromPath("lib/util.js"), "javascript");
    assert.equal(languageFromPath("components/App.jsx"), "javascript");
  });

  await t.test("detects Python", () => {
    assert.equal(languageFromPath("main.py"), "python");
  });

  await t.test("falls back to javascript for unknown extensions", () => {
    assert.equal(languageFromPath("Makefile"), "javascript");
    assert.equal(languageFromPath("no-extension"), "javascript");
  });
});

// ---------------------------------------------------------------------------
// IRBuilder — Module Root
// ---------------------------------------------------------------------------

test("IRBuilder — buildModuleRoot", async (t) => {
  const builder = new IRBuilder();

  await t.test("produces stable deterministic IDs", () => {
    const root1 = builder.buildModuleRoot("", "typescript", "package.json");
    const root2 = builder.buildModuleRoot("", "typescript", "package.json");
    assert.equal(root1.id, root2.id);
    assert.equal(root1.fingerprint, root2.fingerprint);
    assert.equal(root1.kind, "ModuleRoot");
  });

  await t.test("different roots produce different IDs", () => {
    const rootA = builder.buildModuleRoot("packages/a", "typescript", "package.json");
    const rootB = builder.buildModuleRoot("packages/b", "typescript", "package.json");
    assert.notEqual(rootA.id, rootB.id);
    assert.notEqual(rootA.fingerprint, rootB.fingerprint);
  });

  await t.test("empty rootPath is valid (top-level root)", () => {
    const root = builder.buildModuleRoot("", "typescript", "package.json");
    assert.equal(root.rootPath, "");
  });
});

// ---------------------------------------------------------------------------
// IRBuilder — File Node
// ---------------------------------------------------------------------------

test("IRBuilder — buildFileNode", async (t) => {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");

  await t.test("file with no imports/exports → valid FileNode", () => {
    const file = builder.buildFileNode(raw(), root);
    assert.equal(file.kind, "File");
    assert.equal(file.path, "src/index.ts");
    assert.equal(file.language, "typescript");
    assert.equal(file.lineCount, 10);
    assert.equal(file.confidence, "precise");
    assert.equal(file.provenance.origin, "verified");
    assert.equal(file.ownerRootId, root.id);
    assert.deepEqual(file.parseErrors, []);
    assert.deepEqual(file.capabilitiesUsed, ["imports"]);
  });

  await t.test("file that fails to parse → heuristic confidence", () => {
    const file = builder.buildFileNode(
      raw({
        path: "src/broken.ts",
        parseErrors: [
          { message: "unexpected token", severity: "fatal", reason: "syntax" },
        ],
      }),
      root,
    );
    assert.equal(file.confidence, "heuristic");
    assert.equal(file.provenance.origin, "heuristic");
    assert.ok(file.provenance.note);
    assert.equal(file.parseErrors.length, 1);
  });

  await t.test("partial parse errors also yield heuristic", () => {
    const file = builder.buildFileNode(
      raw({
        path: "src/warn.ts",
        parseErrors: [
          { message: "minor issue", severity: "partial", reason: "syntax" },
        ],
      }),
      root,
    );
    assert.equal(file.confidence, "heuristic");
  });

  await t.test("language inferred from file extension", () => {
    const tsFile = builder.buildFileNode(raw({ path: "a.ts" }), root);
    assert.equal(tsFile.language, "typescript");

    const jsFile = builder.buildFileNode(raw({ path: "b.js" }), root);
    assert.equal(jsFile.language, "javascript");

    const tsxFile = builder.buildFileNode(raw({ path: "c.tsx" }), root);
    assert.equal(tsxFile.language, "typescript");
  });

  await t.test("cross-root path collision → unique IDs", () => {
    const rootA = builder.buildModuleRoot("packages/a", "typescript", "package.json");
    const rootB = builder.buildModuleRoot("packages/b", "typescript", "package.json");
    const fileA = builder.buildFileNode(raw({ path: "src/index.ts" }), rootA);
    const fileB = builder.buildFileNode(raw({ path: "src/index.ts" }), rootB);
    assert.notEqual(fileA.id, fileB.id);
  });

  await t.test("deterministic: same input → same FileNode ID", () => {
    const file1 = builder.buildFileNode(raw(), root);
    const file2 = builder.buildFileNode(raw(), root);
    assert.equal(file1.id, file2.id);
  });
});

// ---------------------------------------------------------------------------
// IRBuilder — Edges
// ---------------------------------------------------------------------------

test("IRBuilder — edges", async (t) => {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");

  await t.test("buildContainmentEdge produces correct structure", () => {
    const file = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const edge = builder.buildContainmentEdge(file, root);
    assert.equal(edge.kind, "contains");
    assert.equal(edge.from, root.id);
    assert.equal(edge.to, file.id);
    assert.equal(edge.provenance.origin, "derived");
  });

  await t.test("buildDependencyEdges — precise source → derived provenance", () => {
    const fileA = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const fileB = builder.buildFileNode(raw({ path: "src/b.ts" }), root);
    const edges = builder.buildDependencyEdges(fileA, [
      { targetId: fileB.id, raw: "./b" },
    ]);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].kind, "imports");
    assert.equal(edges[0].from, fileA.id);
    assert.equal(edges[0].to, fileB.id);
    assert.equal(edges[0].provenance.origin, "derived");
    assert.ok(edges[0].provenance.derivedFrom?.includes(fileA.id));
  });

  await t.test("buildDependencyEdges — heuristic source → heuristic provenance (never upgrades)", () => {
    const heuristicFile = builder.buildFileNode(
      raw({
        path: "src/broken.ts",
        parseErrors: [{ message: "err", severity: "partial", reason: "syntax" }],
      }),
      root,
    );
    const target = builder.buildFileNode(raw({ path: "src/target.ts" }), root);
    const edges = builder.buildDependencyEdges(heuristicFile, [
      { targetId: target.id, raw: "./target" },
    ]);
    assert.equal(edges[0].provenance.origin, "heuristic");
    assert.ok(edges[0].provenance.note);
  });

  await t.test("self-import allowed as self-loop edge", () => {
    const file = builder.buildFileNode(raw({ path: "src/self.ts" }), root);
    const edges = builder.buildDependencyEdges(file, [
      { targetId: file.id, raw: "./self" },
    ]);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].from, file.id);
    assert.equal(edges[0].to, file.id);
  });

  await t.test("multiple dependency edges from one file", () => {
    const fileA = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const fileB = builder.buildFileNode(raw({ path: "src/b.ts" }), root);
    const fileC = builder.buildFileNode(raw({ path: "src/c.ts" }), root);
    const edges = builder.buildDependencyEdges(fileA, [
      { targetId: fileB.id, raw: "./b" },
      { targetId: fileC.id, raw: "./c" },
    ]);
    assert.equal(edges.length, 2);
    assert.notEqual(edges[0].id, edges[1].id); // distinct edge IDs
  });
});

// ---------------------------------------------------------------------------
// IRBuilder — External Dependencies
// ---------------------------------------------------------------------------

test("IRBuilder — buildExternalDependencyNode", async (t) => {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");

  await t.test("creates node with verified provenance", () => {
    const ext = builder.buildExternalDependencyNode(
      root.fingerprint,
      "react",
      "typescript",
    );
    assert.equal(ext.kind, "ExternalDependency");
    assert.equal(ext.name, "react");
    // The asserted fact is that the specifier was observed in source, which
    // is directly witnessed. The IR makes no claim the package resolves or
    // is installed, so there is nothing here to overstate. Imports that
    // genuinely could not be resolved are UnresolvedImportNode instead.
    assert.equal(ext.provenance.origin, "verified");
  });

  await t.test("deterministic: same name → same ID", () => {
    const ext1 = builder.buildExternalDependencyNode(root.fingerprint, "lodash", "javascript");
    const ext2 = builder.buildExternalDependencyNode(root.fingerprint, "lodash", "javascript");
    assert.equal(ext1.id, ext2.id);
  });

  await t.test("different names → different IDs", () => {
    const ext1 = builder.buildExternalDependencyNode(root.fingerprint, "react", "typescript");
    const ext2 = builder.buildExternalDependencyNode(root.fingerprint, "vue", "typescript");
    assert.notEqual(ext1.id, ext2.id);
  });
});

// ---------------------------------------------------------------------------
// IRBuilder — finalize
// ---------------------------------------------------------------------------

test("IRBuilder — finalize", async (t) => {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");

  await t.test("produces valid RepositoryIR with irVersion 1", () => {
    const file = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const containment = builder.buildContainmentEdge(file, root);
    const ir = builder.finalize([root, file], [containment], [root]);
    assert.equal(ir.irVersion, 1);
    assert.equal(ir.nodes.length, 2);
    assert.equal(ir.edges.length, 1);
    assert.equal(ir.roots.length, 1);
    assert.ok(ir.generatedAt); // ISO 8601 timestamp
  });

  await t.test("empty repository → valid RepositoryIR (just root)", () => {
    const ir = builder.finalize([root], [], [root]);
    assert.equal(ir.irVersion, 1);
    assert.equal(ir.nodes.length, 1);
    assert.equal(ir.edges.length, 0);
  });

  await t.test("rejects dangling edge references (via validateRepositoryIR)", () => {
    const file = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const containment = builder.buildContainmentEdge(file, root);
    // Omit root from nodes — edge references a non-existent node
    assert.throws(
      () => builder.finalize([file], [containment], [root]),
      IRValidationError,
    );
  });

  await t.test("full pipeline: root + files + containment + imports + externals", () => {
    const fileA = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const fileB = builder.buildFileNode(raw({ path: "src/b.ts" }), root);
    const ext = builder.buildExternalDependencyNode(root.fingerprint, "react", "typescript");

    const containA = builder.buildContainmentEdge(fileA, root);
    const containB = builder.buildContainmentEdge(fileB, root);
    const importEdges = builder.buildDependencyEdges(fileA, [
      { targetId: fileB.id, raw: "./b" },
      { targetId: ext.id, raw: "react" },
    ]);

    const ir = builder.finalize(
      [root, fileA, fileB, ext],
      [containA, containB, ...importEdges],
      [root],
    );

    assert.equal(ir.nodes.length, 4); // root + 2 files + 1 external
    assert.equal(ir.edges.length, 4); // 2 containment + 2 imports
    assert.equal(
      ir.edges.filter((e) => e.kind === "contains").length,
      2,
    );
    assert.equal(
      ir.edges.filter((e) => e.kind === "imports").length,
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// PathIndex
// ---------------------------------------------------------------------------

test("PathIndex", async (t) => {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");

  await t.test("resolve returns NodeId for known path", () => {
    const file = builder.buildFileNode(raw({ path: "src/index.ts" }), root);
    const index = new PathIndex([file]);
    assert.equal(index.resolve("src/index.ts"), file.id);
  });

  await t.test("resolve returns null for unknown path", () => {
    const index = new PathIndex([]);
    assert.equal(index.resolve("does/not/exist.ts"), null);
  });

  await t.test("has returns correct boolean", () => {
    const file = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const index = new PathIndex([file]);
    assert.equal(index.has("src/a.ts"), true);
    assert.equal(index.has("src/b.ts"), false);
  });

  await t.test("size reflects number of indexed files", () => {
    const fileA = builder.buildFileNode(raw({ path: "src/a.ts" }), root);
    const fileB = builder.buildFileNode(raw({ path: "src/b.ts" }), root);
    const index = new PathIndex([fileA, fileB]);
    assert.equal(index.size, 2);
  });

  await t.test("empty index has size 0", () => {
    const index = new PathIndex([]);
    assert.equal(index.size, 0);
  });

  await t.test("multiple files are all resolvable", () => {
    const files = ["src/a.ts", "src/b.ts", "lib/util.ts"].map((p) =>
      builder.buildFileNode(raw({ path: p }), root),
    );
    const index = new PathIndex(files);
    for (const file of files) {
      assert.equal(index.resolve(file.path), file.id);
    }
  });
});
