/**
 * Phase 4 Unit Tests — Python Import Resolution
 *
 * Tests the importResolver module and the PythonParser.resolveImport()
 * integration. Covers:
 *   - Absolute import resolution (module files, package __init__.py)
 *   - Relative import resolution (single-dot, multi-dot, nested)
 *   - Three-outcome classification (resolved-internal, unresolved-internal, external)
 *   - Namespace package handling
 *   - Edge cases (bare relative, walked-past-root, __future__, uninit parser)
 *   - Determinism
 *   - extractAll orchestrator integration with unresolvedKind routing
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  resolveImport,
  _parseSpecifier,
  _derivePackagePosition,
  _walkUp,
  _firstSegmentMatchesKnownPackage,
} from "../../lib/analysis/parsers/python/importResolver";
import {
  buildPackageIndex,
  type PythonPackageIndex,
  type PythonPackageEntry,
} from "../../lib/analysis/parsers/python/packageIndex";
import type { ParseFileInput } from "../../lib/analysis/parsers/interface";
import { PythonParser } from "../../lib/analysis/parsers/python/parser";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "cartograph-resolver-test-"));
}

async function writeProjectFile(root: string, relPath: string, content = ""): Promise<void> {
  const absPath = path.join(root, ...relPath.split("/"));
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf8");
}

function makeFile(root: string, relPath: string): ParseFileInput {
  return {
    absolutePath: path.join(root, ...relPath.split("/")),
    relativePath: relPath,
  };
}

/**
 * Build a standard test project with this structure:
 *   mypackage/
 *     __init__.py
 *     models.py
 *     utils/
 *       __init__.py
 *       helpers.py
 *       formatting.py
 *     views/
 *       __init__.py
 *       home.py
 *   main.py          (top-level module)
 *   config.py        (top-level module)
 */
async function createStandardProject(): Promise<{
  root: string;
  index: PythonPackageIndex;
}> {
  const root = await createTempDir();

  await writeProjectFile(root, "mypackage/__init__.py");
  await writeProjectFile(root, "mypackage/models.py");
  await writeProjectFile(root, "mypackage/utils/__init__.py");
  await writeProjectFile(root, "mypackage/utils/helpers.py");
  await writeProjectFile(root, "mypackage/utils/formatting.py");
  await writeProjectFile(root, "mypackage/views/__init__.py");
  await writeProjectFile(root, "mypackage/views/home.py");
  await writeProjectFile(root, "main.py");
  await writeProjectFile(root, "config.py");

  const index = await buildPackageIndex(root, "structural-heuristic");
  return { root, index };
}

// ---------------------------------------------------------------------------
// Unit Tests: parseSpecifier
// ---------------------------------------------------------------------------

describe("parseSpecifier", () => {
  test("absolute specifier", () => {
    const result = _parseSpecifier("os");
    assert.equal(result.dotLevel, 0);
    assert.equal(result.modulePath, "os");
  });

  test("dotted absolute specifier", () => {
    const result = _parseSpecifier("foo.bar.baz");
    assert.equal(result.dotLevel, 0);
    assert.equal(result.modulePath, "foo.bar.baz");
  });

  test("single-dot relative", () => {
    const result = _parseSpecifier(".sibling");
    assert.equal(result.dotLevel, 1);
    assert.equal(result.modulePath, "sibling");
  });

  test("double-dot relative", () => {
    const result = _parseSpecifier("..cousin");
    assert.equal(result.dotLevel, 2);
    assert.equal(result.modulePath, "cousin");
  });

  test("relative with module path", () => {
    const result = _parseSpecifier("..pkg.mod");
    assert.equal(result.dotLevel, 2);
    assert.equal(result.modulePath, "pkg.mod");
  });

  test("triple-dot bare relative", () => {
    const result = _parseSpecifier("...");
    assert.equal(result.dotLevel, 3);
    assert.equal(result.modulePath, "");
  });
});

// ---------------------------------------------------------------------------
// Unit Tests: derivePackagePosition
// ---------------------------------------------------------------------------

describe("derivePackagePosition", () => {
  // Use platform-appropriate paths
  const importRoot = path.resolve("/project/src");

  test("file directly in import root", () => {
    const result = _derivePackagePosition(
      path.resolve("/project/src/main.py"),
      importRoot,
    );
    assert.equal(result, "");
  });

  test("file one level deep", () => {
    const result = _derivePackagePosition(
      path.resolve("/project/src/mypackage/models.py"),
      importRoot,
    );
    assert.equal(result, "mypackage");
  });

  test("file two levels deep", () => {
    const result = _derivePackagePosition(
      path.resolve("/project/src/mypackage/utils/helpers.py"),
      importRoot,
    );
    assert.equal(result, "mypackage.utils");
  });
});

// ---------------------------------------------------------------------------
// Unit Tests: walkUp
// ---------------------------------------------------------------------------

describe("walkUp", () => {
  test("walk up 0 levels from non-empty", () => {
    assert.equal(_walkUp("mypackage.utils", 0), "mypackage.utils");
  });

  test("walk up 1 level", () => {
    assert.equal(_walkUp("mypackage.utils", 1), "mypackage");
  });

  test("walk up 2 levels", () => {
    assert.equal(_walkUp("mypackage.utils", 2), "");
  });

  test("walk up past root returns null", () => {
    assert.equal(_walkUp("mypackage", 2), null);
  });

  test("walk up 0 levels from root", () => {
    assert.equal(_walkUp("", 0), "");
  });

  test("walk up 1 level from root returns null", () => {
    assert.equal(_walkUp("", 1), null);
  });

  test("walk up from single segment", () => {
    assert.equal(_walkUp("mypackage", 1), "");
  });

  test("walk up 3 levels from 3-segment path", () => {
    assert.equal(_walkUp("a.b.c", 3), "");
  });

  test("walk up 4 levels from 3-segment path returns null", () => {
    assert.equal(_walkUp("a.b.c", 4), null);
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: Absolute Import Resolution
// ---------------------------------------------------------------------------

describe("resolveImport: absolute imports", () => {
  test("resolves top-level module", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "mypackage/models.py");
      const result = resolveImport("config", fromFile, index, root);

      assert.equal(result.resolved, "config.py");
      assert.equal(result.raw, "config");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves package module (e.g., mypackage.models)", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("mypackage.models", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/models.py");
      assert.equal(result.raw, "mypackage.models");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves nested package module", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("mypackage.utils.helpers", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/utils/helpers.py");
      assert.equal(result.raw, "mypackage.utils.helpers");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves package __init__.py (bare package import)", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("mypackage", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/__init__.py");
      assert.equal(result.raw, "mypackage");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves sub-package __init__.py", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("mypackage.utils", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/utils/__init__.py");
      assert.equal(result.raw, "mypackage.utils");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("external import (stdlib)", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("os", fromFile, index, root);

      assert.equal(result.resolved, null);
      assert.equal(result.raw, "os");
      assert.equal(result.unresolvedKind, "external");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("external import (third-party)", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("requests", fromFile, index, root);

      assert.equal(result.resolved, null);
      assert.equal(result.raw, "requests");
      assert.equal(result.unresolvedKind, "external");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("symbol fallback: first segment matches, nonexistent symbol resolves to package __init__", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      // With symbol-level extraction, "mypackage.nonexistent" can originate from
      // `from mypackage import nonexistent`. resolveSymbolFallback correctly
      // strips the symbol and resolves to the package's __init__.py.
      const result = resolveImport("mypackage.nonexistent", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/__init__.py");
      assert.equal(result.unresolvedKind, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("__future__ is always external", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("__future__", fromFile, index, root);

      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "external");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: Relative Import Resolution
// ---------------------------------------------------------------------------

describe("resolveImport: relative imports", () => {
  test("single-dot sibling module (.models from utils)", async () => {
    const { root, index } = await createStandardProject();
    try {
      // From mypackage/utils/helpers.py, `.formatting` refers to
      // mypackage/utils/formatting.py
      const fromFile = makeFile(root, "mypackage/utils/helpers.py");
      const result = resolveImport(".formatting", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/utils/formatting.py");
      assert.equal(result.raw, ".formatting");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("double-dot parent-level module (..models from utils/)", async () => {
    const { root, index } = await createStandardProject();
    try {
      // From mypackage/utils/helpers.py, `..models` refers to
      // mypackage/models.py
      const fromFile = makeFile(root, "mypackage/utils/helpers.py");
      const result = resolveImport("..models", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/models.py");
      assert.equal(result.raw, "..models");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("double-dot cross-package module (..views.home from utils/)", async () => {
    const { root, index } = await createStandardProject();
    try {
      // From mypackage/utils/helpers.py, `..views.home` refers to
      // mypackage/views/home.py
      const fromFile = makeFile(root, "mypackage/utils/helpers.py");
      const result = resolveImport("..views.home", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/views/home.py");
      assert.equal(result.raw, "..views.home");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative import to package __init__.py", async () => {
    const { root, index } = await createStandardProject();
    try {
      // From mypackage/utils/helpers.py, `..views` refers to
      // mypackage/views/__init__.py
      const fromFile = makeFile(root, "mypackage/utils/helpers.py");
      const result = resolveImport("..views", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/views/__init__.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative import with nonexistent symbol resolves to package __init__", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "mypackage/utils/helpers.py");
      // ".nonexistent" from `from . import nonexistent` — resolves to the
      // current package's __init__.py via resolveSymbolFallback, since the
      // symbol might be defined there.
      const result = resolveImport(".nonexistent", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/utils/__init__.py");
      assert.equal(result.unresolvedKind, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative import that walks past root is unresolved-internal", async () => {
    const { root, index } = await createStandardProject();
    try {
      // From main.py (at root level), `..anything` walks past the root
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("..something", fromFile, index, root);

      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "unresolved-internal");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: Namespace Package Resolution
// ---------------------------------------------------------------------------

describe("resolveImport: namespace packages", () => {
  test("namespace package import resolves as unresolved-internal (no __init__.py)", async () => {
    const root = await createTempDir();
    try {
      // Create a namespace package (no __init__.py)
      await writeProjectFile(root, "nspkg/module_a.py");
      await writeProjectFile(root, "nspkg/module_b.py");

      const index = await buildPackageIndex(root, "structural-heuristic");
      const fromFile = makeFile(root, "main.py");

      // Bare import of namespace package — no __init__.py to resolve to
      const result = resolveImport("nspkg", fromFile, index, root);

      // Since nspkg is a known package but has no __init__.py,
      // the bare import can't resolve to a file
      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "unresolved-internal");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("module inside namespace package resolves correctly", async () => {
    const root = await createTempDir();
    try {
      await writeProjectFile(root, "nspkg/module_a.py");
      await writeProjectFile(root, "nspkg/module_b.py");

      const index = await buildPackageIndex(root, "structural-heuristic");
      const fromFile = makeFile(root, "main.py");

      const result = resolveImport("nspkg.module_a", fromFile, index, root);

      assert.equal(result.resolved, "nspkg/module_a.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: src/-Layout Projects
// ---------------------------------------------------------------------------

describe("resolveImport: src/-layout project", () => {
  test("resolves imports relative to src/ import root", async () => {
    const root = await createTempDir();
    try {
      await writeProjectFile(root, "src/mypackage/__init__.py");
      await writeProjectFile(root, "src/mypackage/core.py");
      await writeProjectFile(root, "src/mypackage/utils.py");

      const srcRoot = path.join(root, "src");
      const index = await buildPackageIndex(srcRoot, "declared");

      const fromFile: ParseFileInput = {
        absolutePath: path.join(srcRoot, "mypackage", "core.py"),
        relativePath: "src/mypackage/core.py",
      };

      const result = resolveImport("mypackage.utils", fromFile, index, root);
      assert.equal(result.resolved, "src/mypackage/utils.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: firstSegmentMatchesKnownPackage
// ---------------------------------------------------------------------------

describe("firstSegmentMatchesKnownPackage", () => {
  test("matches known package", () => {
    const packages = new Map<string, PythonPackageEntry>();
    packages.set("mypackage", {
      dottedPath: "mypackage",
      directoryPath: "/fake",
      kind: "regular",
      initFile: "/fake/__init__.py",
      modules: new Map(),
    });

    assert.equal(_firstSegmentMatchesKnownPackage("mypackage.foo", packages), true);
  });

  test("matches top-level module in root package", () => {
    const packages = new Map<string, PythonPackageEntry>();
    packages.set("", {
      dottedPath: "",
      directoryPath: "/fake",
      kind: "namespace",
      initFile: null,
      modules: new Map([["config", "/fake/config.py"]]),
    });

    assert.equal(_firstSegmentMatchesKnownPackage("config", packages), true);
  });

  test("does not match unknown package", () => {
    const packages = new Map<string, PythonPackageEntry>();
    assert.equal(_firstSegmentMatchesKnownPackage("requests.api", packages), false);
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: PythonParser.resolveImport()
// ---------------------------------------------------------------------------

describe("PythonParser.resolveImport() integration", () => {
  test("resolves absolute import through parser", async () => {
    const { root, index } = await createStandardProject();
    try {
      const parser = new PythonParser();
      const pyFiles = [
        "mypackage/__init__.py", "mypackage/models.py",
        "mypackage/utils/__init__.py", "mypackage/utils/helpers.py",
        "mypackage/utils/formatting.py",
        "mypackage/views/__init__.py", "mypackage/views/home.py",
        "main.py", "config.py",
      ];
      const discoveredFiles = pyFiles.map(f => makeFile(root, f));

      await parser.initialize({
        projectRoot: root,
        discoveredFiles,
      });

      const fromFile = makeFile(root, "main.py");
      const result = parser.resolveImport("mypackage.models", fromFile, discoveredFiles);

      assert.equal(result.resolved, "mypackage/models.py");
      assert.equal(result.raw, "mypackage.models");

      parser.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves relative import through parser", async () => {
    const { root, index } = await createStandardProject();
    try {
      const parser = new PythonParser();
      const pyFiles = [
        "mypackage/__init__.py", "mypackage/models.py",
        "mypackage/utils/__init__.py", "mypackage/utils/helpers.py",
        "mypackage/utils/formatting.py",
        "mypackage/views/__init__.py", "mypackage/views/home.py",
        "main.py", "config.py",
      ];
      const discoveredFiles = pyFiles.map(f => makeFile(root, f));

      await parser.initialize({
        projectRoot: root,
        discoveredFiles,
      });

      const fromFile = makeFile(root, "mypackage/utils/helpers.py");
      const result = parser.resolveImport(".formatting", fromFile, discoveredFiles);

      assert.equal(result.resolved, "mypackage/utils/formatting.py");

      parser.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns external for uninitialized parser", () => {
    const parser = new PythonParser();
    const fromFile = makeFile("/fake", "app.py");
    const result = parser.resolveImport("os", fromFile, []);

    assert.equal(result.resolved, null);
    assert.equal(result.raw, "os");
    // When not initialized, unresolvedKind is not set (backward-compatible default)
    assert.equal(result.unresolvedKind, undefined);
  });
});

// ---------------------------------------------------------------------------
// Determinism Tests
// ---------------------------------------------------------------------------

describe("resolveImport: determinism", () => {
  test("same inputs produce identical outputs across multiple calls", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "mypackage/utils/helpers.py");

      const specifiers = [
        "mypackage.models",
        ".formatting",
        "..views.home",
        "os",
        "requests",
        ".nonexistent",
        "mypackage.nonexistent",
      ];

      const run1 = specifiers.map(s => resolveImport(s, fromFile, index, root));
      const run2 = specifiers.map(s => resolveImport(s, fromFile, index, root));

      for (let i = 0; i < specifiers.length; i++) {
        assert.equal(run1[i].resolved, run2[i].resolved, `resolved mismatch for ${specifiers[i]}`);
        assert.equal(run1[i].raw, run2[i].raw, `raw mismatch for ${specifiers[i]}`);
        assert.equal(run1[i].unresolvedKind, run2[i].unresolvedKind, `unresolvedKind mismatch for ${specifiers[i]}`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Edge Case Tests
// ---------------------------------------------------------------------------

describe("resolveImport: edge cases", () => {
  test("deep nonexistent path resolves to nearest ancestor package (known limitation)", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      // resolveSymbolFallback walks up the path hierarchy and finds the
      // nearest existing ancestor. This is a known limitation: deeply
      // nonexistent paths resolve to distant ancestors. In practice this
      // only occurs with broken imports where the intermediate packages
      // don't exist. See symbol_fallback_analysis.md for details.
      const result = resolveImport("mypackage.utils.deep.nested.module", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/utils/__init__.py");
      assert.equal(result.unresolvedKind, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("star import resolves as file-level dependency (from X import *)", async () => {
    // Star imports are extracted as just the module name "X",
    // so they resolve the same as any other absolute import
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "main.py");
      const result = resolveImport("mypackage.utils", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/utils/__init__.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("top-level module resolution", async () => {
    const { root, index } = await createStandardProject();
    try {
      const fromFile = makeFile(root, "mypackage/models.py");
      const result = resolveImport("main", fromFile, index, root);

      assert.equal(result.resolved, "main.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative import from __init__.py", async () => {
    const { root, index } = await createStandardProject();
    try {
      // From mypackage/__init__.py, `.models` refers to mypackage/models.py
      const fromFile = makeFile(root, "mypackage/__init__.py");
      const result = resolveImport(".models", fromFile, index, root);

      assert.equal(result.resolved, "mypackage/models.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative import from deeply nested file", async () => {
    const root = await createTempDir();
    try {
      await writeProjectFile(root, "a/b/c/d/__init__.py");
      await writeProjectFile(root, "a/b/c/d/module.py");
      await writeProjectFile(root, "a/b/__init__.py");
      await writeProjectFile(root, "a/b/target.py");
      await writeProjectFile(root, "a/__init__.py");

      const index = await buildPackageIndex(root, "structural-heuristic");
      const fromFile = makeFile(root, "a/b/c/d/module.py");

      // ...target from a/b/c/d/module.py = walk up 2 levels (to a.b), then resolve target
      const result = resolveImport("...target", fromFile, index, root);

      assert.equal(result.resolved, "a/b/target.py");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
