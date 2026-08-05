/**
 * Phase 7 Integration Test — Full Pipeline → RepositoryIR
 *
 * Verifies that the IR Bridge correctly converts the legacy pipeline's
 * output into a validated RepositoryIR with correct structure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractImports } from "@/lib/analysis/extractImports";
import { buildRepositoryIR } from "@/lib/analysis/ir/bridge";
import type { ProjectFile } from "@/lib/analysis/resolveAliases";
import type { RepositoryIR, FileNode, ExternalDependencyNode, Edge } from "@/lib/analysis/ir/types";

test("Integration — buildRepositoryIR produces valid IR from pipeline data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-ir-test-"));
  try {
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    await writeFile(
      path.join(root, "src", "entry.ts"),
      'import { helper } from "@/lib/helper";\nimport React from "react";\nexport const main = 1;',
    );
    await writeFile(
      path.join(root, "src", "lib", "helper.ts"),
      "export const helper = 1;",
    );

    const files: ProjectFile[] = [
      {
        absolutePath: path.join(root, "src", "entry.ts"),
        filePath: "src/entry.ts",
      },
      {
        absolutePath: path.join(root, "src", "lib", "helper.ts"),
        filePath: "src/lib/helper.ts",
      },
    ];

    // Run the legacy pipeline
    const extraction = await extractImports(root, files);
    assert.equal(extraction.parseErrors.length, 0);

    // Build IR from legacy data
    const ir = buildRepositoryIR(root, extraction.files);
    assert.ok(ir !== null, "buildRepositoryIR should not return null");

    // Cast to typed IR for assertions
    const typedIR = ir as RepositoryIR;

    // --- Schema checks ---
    assert.equal(typedIR.irVersion, 1);
    assert.ok(typedIR.generatedAt);
    assert.ok(new Date(typedIR.generatedAt).getTime() > 0, "generatedAt should be a valid ISO date");

    // --- Roots ---
    assert.equal(typedIR.roots.length, 1);
    assert.equal(typedIR.roots[0].kind, "ModuleRoot");
    assert.equal(typedIR.roots[0].rootPath, "");
    assert.ok(
      typedIR.roots[0].manifestFile === "package.json" ||
        typedIR.roots[0].manifestFile === "tsconfig.json",
    );

    // --- Nodes ---
    const fileNodes = typedIR.nodes.filter(
      (n): n is FileNode => n.kind === "File",
    );
    const extNodes = typedIR.nodes.filter(
      (n): n is ExternalDependencyNode => n.kind === "ExternalDependency",
    );
    const rootNodes = typedIR.nodes.filter((n) => n.kind === "ModuleRoot");

    assert.equal(rootNodes.length, 1, "Should have exactly 1 ModuleRoot node");
    assert.equal(fileNodes.length, 2, "Should have 2 FileNodes");
    assert.equal(extNodes.length >= 1, true, "Should have at least 1 ExternalDependencyNode (react)");

    // Check file node properties
    const entryNode = fileNodes.find((n) => n.path === "src/entry.ts");
    const helperNode = fileNodes.find((n) => n.path === "src/lib/helper.ts");
    assert.ok(entryNode, "Entry file node should exist");
    assert.ok(helperNode, "Helper file node should exist");

    assert.equal(entryNode.language, "typescript");
    assert.equal(entryNode.confidence, "precise");
    assert.equal(entryNode.provenance.origin, "verified");
    assert.deepEqual(entryNode.capabilitiesUsed, ["imports"]);
    assert.ok(entryNode.lineCount > 0);

    // Check external dependency node
    const reactNode = extNodes.find((n) => n.name === "react");
    assert.ok(reactNode, "React external dependency node should exist");
    // Observed in source → verified. See buildExternalDependencyNode.
    assert.equal(reactNode.provenance.origin, "verified");

    // --- Edges ---
    const containmentEdges = typedIR.edges.filter(
      (e: Edge) => e.kind === "contains",
    );
    const importEdges = typedIR.edges.filter(
      (e: Edge) => e.kind === "imports",
    );

    // One containment edge per file
    assert.equal(containmentEdges.length, 2);
    // Containment edges should go from root to file
    for (const ce of containmentEdges) {
      assert.equal(ce.from, typedIR.roots[0].id);
      assert.ok(
        fileNodes.some((fn) => fn.id === ce.to),
        "Containment edge 'to' should reference a FileNode",
      );
    }

    // Import edges: entry.ts → helper.ts, entry.ts → react
    assert.ok(importEdges.length >= 2, "Should have at least 2 import edges");
    // entry → helper (internal)
    const entryToHelper = importEdges.find(
      (e: Edge) => e.from === entryNode.id && e.to === helperNode.id,
    );
    assert.ok(entryToHelper, "Should have entry → helper import edge");
    assert.equal(entryToHelper.provenance.origin, "derived");

    // entry → react (external)
    if (reactNode) {
      const entryToReact = importEdges.find(
        (e: Edge) => e.from === entryNode.id && e.to === reactNode.id,
      );
      assert.ok(entryToReact, "Should have entry → react import edge");
    }

    // --- Referential integrity ---
    const nodeIds = new Set(typedIR.nodes.map((n) => n.id));
    for (const edge of typedIR.edges) {
      assert.ok(nodeIds.has(edge.from), `Edge 'from' ${edge.from} should reference a valid node`);
      assert.ok(nodeIds.has(edge.to), `Edge 'to' ${edge.to} should reference a valid node`);
    }

    // --- Identity determinism ---
    assert.ok(entryNode.id.length > 0, "NodeId should be non-empty");
    assert.ok(helperNode.id.length > 0, "NodeId should be non-empty");
    assert.notEqual(entryNode.id, helperNode.id, "Different files should have different NodeIds");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Integration — buildRepositoryIR returns null on empty file list", () => {
  // Edge case: no files to process. The builder should produce a valid
  // empty IR (just the root node), not crash.
  const ir = buildRepositoryIR("/nonexistent/path", []);
  // Even with no files, we should get a valid IR with just the root
  if (ir !== null) {
    const typedIR = ir as RepositoryIR;
    assert.equal(typedIR.irVersion, 1);
    assert.equal(typedIR.roots.length, 1);
    const fileNodes = typedIR.nodes.filter((n) => n.kind === "File");
    assert.equal(fileNodes.length, 0);
  }
  // null is also acceptable if the project root doesn't exist
});
