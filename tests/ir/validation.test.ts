import assert from "node:assert/strict";
import test from "node:test";
import {
  IRValidationError,
  validateEdge,
  validateFileNode,
  validateModuleRoot,
  validateParseError,
  validateProvenance,
  validateRepositoryIR,
} from "@/lib/analysis/ir/validation";
import type { NodeId, EdgeId } from "@/lib/analysis/ir/types";

// ---------------------------------------------------------------------------
// Helpers — minimal valid structures for composing tests
// ---------------------------------------------------------------------------

function validProvenance() {
  return { origin: "verified" };
}

function validModuleRoot(overrides: Record<string, unknown> = {}) {
  return {
    id: "root1" as NodeId,
    kind: "ModuleRoot",
    rootPath: "",
    language: "typescript",
    manifestFile: "package.json",
    confidence: "declared",
    fingerprint: "abc123",
    ...overrides,
  };
}

function validFileNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "file1" as NodeId,
    kind: "File",
    path: "src/index.ts",
    language: "typescript",
    lineCount: 42,
    ownerRootId: "root1" as NodeId,
    confidence: "precise",
    parseErrors: [],
    capabilitiesUsed: ["imports"],
    provenance: validProvenance(),
    ...overrides,
  };
}

function validEdge(overrides: Record<string, unknown> = {}) {
  return {
    id: "edge1" as EdgeId,
    kind: "contains",
    from: "root1" as NodeId,
    to: "file1" as NodeId,
    provenance: validProvenance(),
    ...overrides,
  };
}

function validRepositoryIR(overrides: Record<string, unknown> = {}) {
  const root = validModuleRoot();
  const file = validFileNode();
  const edge = validEdge();
  return {
    irVersion: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    nodes: [root, file],
    edges: [edge],
    roots: [root],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

test("Validation — Provenance", async (t) => {
  await t.test("accepts a valid verified provenance", () => {
    const result = validateProvenance({ origin: "verified" }, "test");
    assert.equal(result.origin, "verified");
  });

  await t.test("accepts provenance with derivedFrom and note", () => {
    const result = validateProvenance(
      { origin: "heuristic", derivedFrom: ["a", "b"], note: "best guess" },
      "test",
    );
    assert.equal(result.origin, "heuristic");
    assert.deepEqual(result.derivedFrom, ["a", "b"]);
    assert.equal(result.note, "best guess");
  });

  await t.test("rejects invalid origin", () => {
    assert.throws(
      () => validateProvenance({ origin: "magic" }, "test"),
      IRValidationError,
    );
  });

  await t.test("rejects non-object", () => {
    assert.throws(
      () => validateProvenance("not-an-object", "test"),
      IRValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// ParseError
// ---------------------------------------------------------------------------

test("Validation — ParseError", async (t) => {
  await t.test("accepts a valid parse error", () => {
    const result = validateParseError(
      { message: "unexpected token", severity: "fatal", reason: "syntax", line: 10, column: 5 },
      "test",
    );
    assert.equal(result.message, "unexpected token");
    assert.equal(result.severity, "fatal");
    assert.equal(result.reason, "syntax");
    assert.equal(result.line, 10);
    assert.equal(result.column, 5);
  });

  await t.test("accepts parse error without optional line/column", () => {
    const result = validateParseError(
      { message: "binary file", severity: "fatal", reason: "unreadable" },
      "test",
    );
    assert.equal(result.line, undefined);
    assert.equal(result.column, undefined);
  });

  await t.test("rejects empty message", () => {
    assert.throws(
      () => validateParseError({ message: "", severity: "fatal", reason: "syntax" }, "test"),
      IRValidationError,
    );
  });

  await t.test("rejects invalid severity", () => {
    assert.throws(
      () => validateParseError({ message: "err", severity: "warning", reason: "syntax" }, "test"),
      IRValidationError,
    );
  });

  await t.test("rejects invalid reason", () => {
    assert.throws(
      () => validateParseError({ message: "err", severity: "fatal", reason: "bug" }, "test"),
      IRValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// FileNode
// ---------------------------------------------------------------------------

test("Validation — FileNode", async (t) => {
  await t.test("accepts a valid FileNode", () => {
    const result = validateFileNode(validFileNode(), "test");
    assert.equal(result.kind, "File");
    assert.equal(result.path, "src/index.ts");
    assert.equal(result.confidence, "precise");
  });

  await t.test("rejects missing id", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ id: "" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects invalid language", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ language: "ruby" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects negative lineCount", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ lineCount: -1 }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects fractional lineCount", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ lineCount: 3.14 }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects invalid confidence", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ confidence: "maybe" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects wrong kind", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ kind: "ModuleRoot" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects non-array parseErrors", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ parseErrors: "none" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects invalid capabilitiesUsed entry", () => {
    assert.throws(
      () => validateFileNode(validFileNode({ capabilitiesUsed: ["teleport"] }), "test"),
      IRValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// ModuleRoot
// ---------------------------------------------------------------------------

test("Validation — ModuleRoot", async (t) => {
  await t.test("accepts a valid ModuleRoot", () => {
    const result = validateModuleRoot(validModuleRoot(), "test");
    assert.equal(result.kind, "ModuleRoot");
    assert.equal(result.manifestFile, "package.json");
  });

  await t.test("accepts empty rootPath (top-level root)", () => {
    const result = validateModuleRoot(validModuleRoot({ rootPath: "" }), "test");
    assert.equal(result.rootPath, "");
  });

  await t.test("rejects empty manifestFile", () => {
    assert.throws(
      () => validateModuleRoot(validModuleRoot({ manifestFile: "" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects empty fingerprint", () => {
    assert.throws(
      () => validateModuleRoot(validModuleRoot({ fingerprint: "" }), "test"),
      IRValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

test("Validation — Edge", async (t) => {
  await t.test("accepts a valid edge", () => {
    const result = validateEdge(validEdge(), "test");
    assert.equal(result.kind, "contains");
  });

  await t.test("rejects invalid edge kind", () => {
    assert.throws(
      () => validateEdge(validEdge({ kind: "depends" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects empty from", () => {
    assert.throws(
      () => validateEdge(validEdge({ from: "" }), "test"),
      IRValidationError,
    );
  });

  await t.test("rejects empty to", () => {
    assert.throws(
      () => validateEdge(validEdge({ to: "" }), "test"),
      IRValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// RepositoryIR — Schema
// ---------------------------------------------------------------------------

test("Validation — RepositoryIR schema", async (t) => {
  await t.test("accepts a valid RepositoryIR", () => {
    const result = validateRepositoryIR(validRepositoryIR());
    assert.equal(result.irVersion, 1);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.edges.length, 1);
    assert.equal(result.roots.length, 1);
  });

  await t.test("rejects wrong irVersion", () => {
    assert.throws(
      () => validateRepositoryIR(validRepositoryIR({ irVersion: 2 })),
      IRValidationError,
    );
  });

  await t.test("rejects missing generatedAt", () => {
    assert.throws(
      () => validateRepositoryIR(validRepositoryIR({ generatedAt: "" })),
      IRValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// RepositoryIR — Referential Integrity
// ---------------------------------------------------------------------------

test("Validation — Referential integrity", async (t) => {
  await t.test("rejects duplicate node IDs", () => {
    const root = validModuleRoot();
    const file1 = validFileNode({ id: "dup" });
    const file2 = validFileNode({ id: "dup", path: "src/other.ts" });
    assert.throws(
      () =>
        validateRepositoryIR({
          ...validRepositoryIR(),
          nodes: [root, file1, file2],
          edges: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("duplicate node ID"));
        return true;
      },
    );
  });

  await t.test("rejects duplicate edge IDs", () => {
    const root = validModuleRoot();
    const file1 = validFileNode({ id: "f1" });
    const file2 = validFileNode({ id: "f2", path: "src/b.ts" });
    const edge1 = validEdge({ id: "e", kind: "contains", from: "root1", to: "f1" });
    const edge2 = validEdge({ id: "e", kind: "contains", from: "root1", to: "f2" });
    assert.throws(
      () =>
        validateRepositoryIR({
          ...validRepositoryIR(),
          nodes: [root, file1, file2],
          edges: [edge1, edge2],
        }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("duplicate edge ID"));
        return true;
      },
    );
  });

  await t.test("rejects edge referencing non-existent node (from)", () => {
    const dangling = validEdge({ from: "ghost" });
    assert.throws(
      () => validateRepositoryIR({ ...validRepositoryIR(), edges: [dangling] }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("non-existent node"));
        return true;
      },
    );
  });

  await t.test("rejects edge referencing non-existent node (to)", () => {
    const dangling = validEdge({ to: "ghost" });
    assert.throws(
      () => validateRepositoryIR({ ...validRepositoryIR(), edges: [dangling] }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("non-existent node"));
        return true;
      },
    );
  });

  await t.test("rejects root not found in nodes", () => {
    const orphanRoot = validModuleRoot({ id: "orphan", fingerprint: "xyz" });
    assert.throws(
      () =>
        validateRepositoryIR({
          ...validRepositoryIR(),
          roots: [orphanRoot],
        }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("not found in nodes"));
        return true;
      },
    );
  });

  await t.test("rejects FileNode with ownerRootId not in roots", () => {
    const root = validModuleRoot();
    const file = validFileNode({ ownerRootId: "nonexistent" });
    assert.throws(
      () =>
        validateRepositoryIR({
          ...validRepositoryIR(),
          nodes: [root, file],
        }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("non-existent root"));
        return true;
      },
    );
  });

  await t.test("rejects containment edge where from is not ModuleRoot", () => {
    const root = validModuleRoot();
    const file1 = validFileNode({ id: "f1" });
    const file2 = validFileNode({ id: "f2", path: "src/b.ts" });
    const bad = validEdge({ id: "bad1", kind: "contains", from: "f1", to: "f2" });
    const good = validEdge({ id: "good1", kind: "contains", from: "root1", to: "f1" });
    assert.throws(
      () =>
        validateRepositoryIR({
          ...validRepositoryIR(),
          nodes: [root, file1, file2],
          edges: [good, bad],
        }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("containment edge"));
        return true;
      },
    );
  });

  await t.test("rejects import edge where from is not File", () => {
    const root = validModuleRoot();
    const file = validFileNode();
    const bad = validEdge({ id: "bad1", kind: "imports", from: "root1", to: "file1" });
    assert.throws(
      () =>
        validateRepositoryIR({
          ...validRepositoryIR(),
          nodes: [root, file],
          edges: [bad],
        }),
      (error: unknown) => {
        assert.ok(error instanceof IRValidationError);
        assert.ok(error.detail.includes("import edge"));
        return true;
      },
    );
  });

  await t.test("accepts a valid empty repository (no files, just root)", () => {
    const root = validModuleRoot();
    const result = validateRepositoryIR({
      irVersion: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      nodes: [root],
      edges: [],
      roots: [root],
    });
    assert.equal(result.nodes.length, 1);
    assert.equal(result.edges.length, 0);
  });
});
