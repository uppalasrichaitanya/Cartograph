/**
 * Python Parser — Phase 2 Unit Tests
 *
 * Tests the PythonParser class lifecycle: initialize(), dispose(),
 * metadata loading, package index creation, repeated initialization,
 * deterministic behavior, and fallback scenarios.
 *
 * These tests exercise the parser through the LanguageParser interface
 * contract, verifying that PythonParser behaves identically to the
 * TypeScript parser's lifecycle patterns.
 *
 * Created as part of Milestone 3, Phase 2 (PythonParser.initialize()).
 *
 * @module tests/python/parser.test
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PythonParser } from "@/lib/analysis/parsers/python/parser";
import type { ParseFileInput, ParserInitContext } from "@/lib/analysis/parsers/interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cartograph-py-parser-test-"));
}

async function writeProjectFile(root: string, relPath: string, content: string): Promise<void> {
  const fullPath = path.join(root, ...relPath.split("/"));
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

function makeContext(projectRoot: string, files: string[] = []): ParserInitContext {
  const discoveredFiles: ParseFileInput[] = files.map(f => ({
    absolutePath: path.join(projectRoot, ...f.split("/")),
    relativePath: f,
  }));
  return { projectRoot, discoveredFiles };
}

// ---------------------------------------------------------------------------
// Parser Metadata & Identity
// ---------------------------------------------------------------------------

test("PythonParser: static metadata matches specification", () => {
  const parser = new PythonParser();
  assert.equal(parser.id, "python");
  assert.equal(parser.name, "Python");
  assert.equal(parser.language, "python");
  assert.deepEqual([...parser.extensions], ["py"]);
  assert.deepEqual([...parser.capabilities], ["imports"]);
});

test("PythonParser: canHandle() returns true for .py only", () => {
  const parser = new PythonParser();
  assert.equal(parser.canHandle("py"), true);
  assert.equal(parser.canHandle("PY"), false); // case-sensitive per interface contract
  assert.equal(parser.canHandle("ts"), false);
  assert.equal(parser.canHandle("js"), false);
  assert.equal(parser.canHandle("pyx"), false);
  assert.equal(parser.canHandle(""), false);
});

// ---------------------------------------------------------------------------
// Initialize — Basic Lifecycle
// ---------------------------------------------------------------------------

test("PythonParser: initialize() with flat-layout project", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");
    await writeProjectFile(root, "utils.py", "import sys");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root, ["app.py", "utils.py"]));

    // Import root should be the project root (no src/, no config)
    assert.equal(parser.importRoot, root);
    assert.equal(parser.rootConfidence, "structural-heuristic");
    assert.equal(parser.declaredPackageName, null);

    // Package index should be built
    const index = parser.getPackageIndex();
    assert.ok(index, "Package index should be built");
    assert.equal(index.importRoot, root);

    // Top-level modules should be indexed
    const rootEntry = index.packages.get("");
    assert.ok(rootEntry, "Root entry should exist");
    assert.ok(rootEntry.modules.has("app"));
    assert.ok(rootEntry.modules.has("utils"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() with src/-layout project", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "src/mypackage/__init__.py", "");
    await writeProjectFile(root, "src/mypackage/core.py", "import os");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    assert.equal(parser.importRoot, path.join(root, "src"));
    assert.equal(parser.rootConfidence, "structural-heuristic");

    const index = parser.getPackageIndex();
    assert.ok(index);
    assert.ok(index.packages.has("mypackage"));
    assert.equal(index.packages.get("mypackage")!.kind, "regular");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() with pyproject.toml declared layout", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[project]
name = "my-package"

[tool.setuptools.packages.find]
where = ["src"]
`);
    await writeProjectFile(root, "src/mypackage/__init__.py", "");
    await writeProjectFile(root, "src/mypackage/core.py", "import os");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    assert.equal(parser.importRoot, path.join(root, "src"));
    assert.equal(parser.rootConfidence, "declared");
    assert.equal(parser.declaredPackageName, "my-package");

    const index = parser.getPackageIndex();
    assert.ok(index);
    assert.equal(index.rootConfidence, "declared");
    assert.ok(index.packages.has("mypackage"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() with setup.cfg declared layout", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "setup.cfg", `
[options.packages.find]
where = src
`);
    await writeProjectFile(root, "src/pkg/__init__.py", "");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    assert.equal(parser.importRoot, path.join(root, "src"));
    assert.equal(parser.rootConfidence, "declared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Initialize — Fallback Scenarios
// ---------------------------------------------------------------------------

test("PythonParser: initialize() falls back to structural when config path is broken", async () => {
  const root = await createTempProject();
  try {
    // pyproject.toml declares "lib/" but it doesn't exist
    await writeProjectFile(root, "pyproject.toml", `
[tool.setuptools.packages.find]
where = ["lib"]
`);
    // src/ exists with Python files
    await writeProjectFile(root, "src/mypackage/__init__.py", "");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    assert.equal(parser.importRoot, path.join(root, "src"));
    assert.equal(parser.rootConfidence, "structural-heuristic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() falls back to project root when no src/ and no config", async () => {
  const root = await createTempProject();
  try {
    // No pyproject.toml, no setup.cfg, no src/
    await writeProjectFile(root, "main.py", "print('hello')");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root, ["main.py"]));

    assert.equal(parser.importRoot, root);
    assert.equal(parser.rootConfidence, "structural-heuristic");
    assert.equal(parser.declaredPackageName, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() with invalid TOML falls through gracefully", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", "this is [[[not valid toml");
    await writeProjectFile(root, "app.py", "import os");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    // Should not throw — falls through to structural heuristic
    assert.equal(parser.importRoot, root);
    assert.equal(parser.rootConfidence, "structural-heuristic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Initialize — Package Index Validation
// ---------------------------------------------------------------------------

test("PythonParser: initialize() builds package index with namespace packages", async () => {
  const root = await createTempProject();
  try {
    // Namespace package (no __init__.py) with .py files
    await writeProjectFile(root, "mynamespace/utils.py", "import os");
    await writeProjectFile(root, "mynamespace/helpers.py", "import sys");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    const index = parser.getPackageIndex();
    assert.ok(index);

    const ns = index.packages.get("mynamespace");
    assert.ok(ns, "Namespace package should be indexed");
    assert.equal(ns.kind, "namespace");
    assert.equal(ns.initFile, null);
    assert.ok(ns.modules.has("utils"));
    assert.ok(ns.modules.has("helpers"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() builds nested package structure correctly", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    await writeProjectFile(root, "mypackage/utils/__init__.py", "");
    await writeProjectFile(root, "mypackage/utils/helpers.py", "import sys");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    const index = parser.getPackageIndex();
    assert.ok(index);
    assert.ok(index.packages.has("mypackage"));
    assert.ok(index.packages.has("mypackage.utils"));

    const utils = index.packages.get("mypackage.utils")!;
    assert.equal(utils.kind, "regular");
    assert.ok(utils.modules.has("helpers"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: initialize() excludes __pycache__ and .venv from index", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    await writeProjectFile(root, "mypackage/__pycache__/core.cpython-311.pyc", "compiled");
    await writeProjectFile(root, ".venv/lib/site-packages/requests/__init__.py", "");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    const index = parser.getPackageIndex();
    assert.ok(index);
    assert.ok(!index.packages.has("mypackage.__pycache__"));
    assert.ok(!index.packages.has(".venv"));
    assert.ok(index.packages.has("mypackage"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

test("PythonParser: dispose() clears all cached state", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root, ["app.py"]));

    // State should be populated
    assert.ok(parser.importRoot);
    assert.ok(parser.rootConfidence);
    assert.ok(parser.getPackageIndex());

    // After dispose, everything should be null
    parser.dispose();

    assert.equal(parser.importRoot, null);
    assert.equal(parser.rootConfidence, null);
    assert.equal(parser.declaredPackageName, null);
    assert.equal(parser.getPackageIndex(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: dispose() is safe to call before initialize()", () => {
  const parser = new PythonParser();
  // Should not throw — dispose() on a never-initialized parser is a no-op
  parser.dispose();
  assert.equal(parser.importRoot, null);
  assert.equal(parser.getPackageIndex(), null);
});

test("PythonParser: dispose() is safe to call multiple times", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    parser.dispose();
    parser.dispose(); // Second call should not throw
    parser.dispose(); // Third call should not throw

    assert.equal(parser.importRoot, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Re-initialization
// ---------------------------------------------------------------------------

test("PythonParser: re-initialize() discards previous state", async () => {
  const root1 = await createTempProject();
  const root2 = await createTempProject();
  try {
    // First project: src/ layout
    await writeProjectFile(root1, "src/pkg1/__init__.py", "");
    await writeProjectFile(root1, "src/pkg1/mod.py", "import os");

    // Second project: flat layout
    await writeProjectFile(root2, "pkg2/__init__.py", "");
    await writeProjectFile(root2, "pkg2/mod.py", "import sys");

    const parser = new PythonParser();

    // Initialize with first project
    await parser.initialize(makeContext(root1));
    assert.equal(parser.importRoot, path.join(root1, "src"));
    assert.ok(parser.getPackageIndex()!.packages.has("pkg1"));

    // Re-initialize with second project — should fully replace state
    await parser.initialize(makeContext(root2));
    assert.equal(parser.importRoot, root2);
    assert.ok(!parser.getPackageIndex()!.packages.has("pkg1"), "pkg1 should be gone");
    assert.ok(parser.getPackageIndex()!.packages.has("pkg2"), "pkg2 should be present");
  } finally {
    await rm(root1, { recursive: true, force: true });
    await rm(root2, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("PythonParser: initialize() produces deterministic results across runs", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "zebra/__init__.py", "");
    await writeProjectFile(root, "zebra/z.py", "");
    await writeProjectFile(root, "alpha/__init__.py", "");
    await writeProjectFile(root, "alpha/a.py", "");
    await writeProjectFile(root, "middle/__init__.py", "");
    await writeProjectFile(root, "middle/m.py", "");

    const parser1 = new PythonParser();
    await parser1.initialize(makeContext(root));
    const keys1 = [...parser1.getPackageIndex()!.packages.keys()];

    const parser2 = new PythonParser();
    await parser2.initialize(makeContext(root));
    const keys2 = [...parser2.getPackageIndex()!.packages.keys()];

    assert.deepEqual(keys1, keys2, "Package keys should be identical across runs");

    // Verify alphabetical order (excluding root "")
    const namedKeys = keys1.filter(k => k !== "");
    assert.deepEqual(namedKeys, ["alpha", "middle", "zebra"]);

    parser1.dispose();
    parser2.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Stub Behavior — parseFile() and resolveImport()
// ---------------------------------------------------------------------------

test("PythonParser: parseFile() extracts imports", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os\nimport sys\n");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root, ["app.py"]));

    const file: ParseFileInput = {
      absolutePath: path.join(root, "app.py"),
      relativePath: "app.py",
    };

    const result = parser.parseFile(file, "import os\nimport sys\n");

    assert.equal(result.path, "app.py");
    assert.equal(result.lineCount, 3); // 2 lines + trailing newline
    assert.deepEqual([...result.internalImports], ["os", "sys"]);
    assert.deepEqual([...result.externalImports], []);
    assert.deepEqual([...result.parseErrors], []);
    assert.deepEqual([...result.capabilitiesUsed], ["imports"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: parseFile() handles parse errors safely", async () => {
  const parser = new PythonParser();
  const file: ParseFileInput = {
    absolutePath: "/fake/path/app.py",
    relativePath: "app.py",
  };

  const result = parser.parseFile(file, "invalid python {{[[[");

  assert.equal(result.path, "app.py");
  assert.equal(result.parseErrors.length, 1);
  assert.equal(result.parseErrors[0].severity, "partial");
  assert.equal(result.parseErrors[0].reason, "syntax");
});

test("PythonParser: resolveImport() stub returns external for everything", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root, ["app.py"]));

    const file: ParseFileInput = {
      absolutePath: path.join(root, "app.py"),
      relativePath: "app.py",
    };

    const result = parser.resolveImport("os", file, [file]);

    assert.equal(result.resolved, null);
    assert.equal(result.raw, "os");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PythonParser: resolveImport() stub never throws", () => {
  const parser = new PythonParser();
  // Call without initialize — should still not throw
  const file: ParseFileInput = {
    absolutePath: "/fake/path/app.py",
    relativePath: "app.py",
  };

  const result = parser.resolveImport("nonexistent.module", file, []);
  assert.equal(result.resolved, null);
  assert.equal(result.raw, "nonexistent.module");
});

// ---------------------------------------------------------------------------
// Registry Integration
// ---------------------------------------------------------------------------

test("PythonParser: integrates with ParserRegistry without collisions", async () => {
  // Import dynamically to avoid circular dependency issues in test isolation
  const { ParserRegistry } = await import("@/lib/analysis/parsers/registry");
  const { TypeScriptParser } = await import("@/lib/analysis/parsers/typescript/parser");

  const registry = new ParserRegistry();
  const tsParser = new TypeScriptParser();
  const pyParser = new PythonParser();

  // Both should register without collision
  registry.register(tsParser);
  registry.register(pyParser);

  // Dispatch should work correctly
  assert.equal(registry.getParserForExtension("ts"), tsParser);
  assert.equal(registry.getParserForExtension("py"), pyParser);
  assert.equal(registry.getParserForExtension("tsx"), tsParser);
  assert.equal(registry.getParserForExtension("rb"), null); // No Ruby parser

  // Both extensions should be registered
  const exts = registry.getRegisteredExtensions();
  assert.ok(exts.has("py"), "py should be registered");
  assert.ok(exts.has("ts"), "ts should be registered");
  assert.ok(exts.has("tsx"), "tsx should be registered");
  assert.ok(exts.has("js"), "js should be registered");
  assert.ok(exts.has("jsx"), "jsx should be registered");
});

test("PythonParser: registry lifecycle (initializeAll/disposeAll) works", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");
    await writeProjectFile(root, "main.ts", "import fs from 'fs'");

    const { ParserRegistry } = await import("@/lib/analysis/parsers/registry");
    const { TypeScriptParser } = await import("@/lib/analysis/parsers/typescript/parser");

    const registry = new ParserRegistry();
    const pyParser = new PythonParser();
    const tsParser = new TypeScriptParser();

    registry.register(tsParser);
    registry.register(pyParser);

    const context = makeContext(root, ["app.py", "main.ts"]);

    // initializeAll should initialize both parsers
    await registry.initializeAll(context);

    // Python parser should be initialized
    assert.ok(pyParser.importRoot, "Python parser should be initialized");
    assert.ok(pyParser.getPackageIndex(), "Package index should be built");

    // disposeAll should clean up both
    registry.disposeAll();

    assert.equal(pyParser.importRoot, null, "Python parser should be disposed");
    assert.equal(pyParser.getPackageIndex(), null, "Package index should be cleared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Empty Project
// ---------------------------------------------------------------------------

test("PythonParser: initialize() with empty project (no .py files)", async () => {
  const root = await createTempProject();
  try {
    // Project with no Python files at all
    await writeProjectFile(root, "README.md", "# Hello");

    const parser = new PythonParser();
    await parser.initialize(makeContext(root));

    // Should not throw — root detection still works
    assert.ok(parser.importRoot);
    assert.ok(parser.getPackageIndex());

    // Package index should be empty (no packages found)
    assert.equal(parser.getPackageIndex()!.packages.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
