/**
 * Python Metadata & Root Detection Tests
 *
 * Tests the import-root detection heuristic (§3.1) and package index
 * builder (§4.1) in isolation from the parser lifecycle.
 *
 * Each test creates a temporary directory structure mimicking a real
 * Python project layout, runs the detection/indexing logic, and
 * asserts the expected result.
 *
 * Created as part of Milestone 3, Phase 1 (Metadata & Root Detection).
 *
 * @module tests/python/metadata.test
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { detectImportRoot, _parseSetupCfgKeys } from "@/lib/analysis/parsers/python/metadata";
import { buildPackageIndex } from "@/lib/analysis/parsers/python/packageIndex";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cartograph-py-test-"));
}

async function writeProjectFile(root: string, relPath: string, content: string): Promise<void> {
  const fullPath = path.join(root, ...relPath.split("/"));
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

// ---------------------------------------------------------------------------
// §3.1 Import-Root Detection
// ---------------------------------------------------------------------------

test("Metadata: flat-layout project (no config, no src/)", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");
    await writeProjectFile(root, "utils.py", "import sys");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, root);
    assert.equal(result.rootConfidence, "structural-heuristic");
    assert.equal(result.declaredPackageName, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: src/-layout project (structural heuristic)", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "src/mypackage/__init__.py", "");
    await writeProjectFile(root, "src/mypackage/core.py", "import os");
    await writeProjectFile(root, "tests/test_core.py", "import pytest");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "structural-heuristic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: src/ directory with no Python files falls back to project root", async () => {
  const root = await createTempProject();
  try {
    // src/ exists but contains no .py files — should NOT be selected
    await writeProjectFile(root, "src/README.md", "# readme");
    await writeProjectFile(root, "app.py", "import os");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, root);
    assert.equal(result.rootConfidence, "structural-heuristic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: pyproject.toml with setuptools packages.find.where", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[project]
name = "my-cool-package"

[tool.setuptools.packages.find]
where = ["src"]
`);
    await writeProjectFile(root, "src/mypackage/__init__.py", "");
    await writeProjectFile(root, "src/mypackage/core.py", "import os");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "declared");
    assert.equal(result.declaredPackageName, "my-cool-package");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: pyproject.toml with setuptools package-dir", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[project]
name = "dirpkg"

[tool.setuptools]
package-dir = {"" = "lib"}
`);
    await writeProjectFile(root, "lib/mypackage/__init__.py", "");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "lib"));
    assert.equal(result.rootConfidence, "declared");
    assert.equal(result.declaredPackageName, "dirpkg");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: pyproject.toml with hatch build config", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[project]
name = "hatch-app"

[tool.hatch.build.targets.wheel]
packages = ["src/mypackage"]
`);
    await writeProjectFile(root, "src/mypackage/__init__.py", "");
    await writeProjectFile(root, "src/mypackage/main.py", "import os");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "declared");
    assert.equal(result.declaredPackageName, "hatch-app");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: pyproject.toml with poetry packages config", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[project]
name = "poetry-app"

[[tool.poetry.packages]]
include = "mypackage"
from = "src"
`);
    await writeProjectFile(root, "src/mypackage/__init__.py", "");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "declared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: pyproject.toml with flit module config", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[project]
name = "flit-app"

[tool.flit.module]
name = "mypackage"
`);
    await writeProjectFile(root, "mypackage/__init__.py", "");

    const result = await detectImportRoot(root);

    // Flit convention: flat layout, import root = project root
    assert.equal(result.importRoot, root);
    assert.equal(result.rootConfidence, "declared");
    assert.equal(result.declaredPackageName, "flit-app");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: setup.cfg with package_dir", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "setup.cfg", `
[options]
package_dir =
    = src

[options.packages.find]
where = src
`);
    await writeProjectFile(root, "src/mypackage/__init__.py", "");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "declared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: broken declared path falls through to structural heuristic", async () => {
  const root = await createTempProject();
  try {
    // pyproject.toml declares "lib/" but that directory doesn't exist
    await writeProjectFile(root, "pyproject.toml", `
[tool.setuptools.packages.find]
where = ["lib"]
`);
    // But src/ exists with Python files — structural heuristic should find it
    await writeProjectFile(root, "src/mypackage/__init__.py", "");
    await writeProjectFile(root, "src/mypackage/core.py", "import os");

    const result = await detectImportRoot(root);

    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "structural-heuristic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: pyproject.toml takes priority over setup.cfg", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "pyproject.toml", `
[tool.setuptools.packages.find]
where = ["src"]
`);
    await writeProjectFile(root, "setup.cfg", `
[options.packages.find]
where = lib
`);
    await writeProjectFile(root, "src/pkg/__init__.py", "");
    await writeProjectFile(root, "lib/otherpkg/__init__.py", "");

    const result = await detectImportRoot(root);

    // pyproject.toml wins (Step 1 before Step 2)
    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "declared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Metadata: invalid TOML is treated as no config", async () => {
  const root = await createTempProject();
  try {
    // Invalid TOML — should be treated as if the file doesn't exist
    await writeProjectFile(root, "pyproject.toml", `
this is not valid toml [[[
`);
    await writeProjectFile(root, "src/mypackage/__init__.py", "");

    const result = await detectImportRoot(root);

    // Falls through to structural heuristic
    assert.equal(result.importRoot, path.join(root, "src"));
    assert.equal(result.rootConfidence, "structural-heuristic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// setup.cfg Parser Unit Tests
// ---------------------------------------------------------------------------

test("parseSetupCfgKeys: extracts package_dir and where", () => {
  const result = _parseSetupCfgKeys(`
[options]
package_dir =
    = src

[options.packages.find]
where = src
`);
  assert.equal(result.packageDir, "src");
  assert.equal(result.packagesWhere, "src");
});

test("parseSetupCfgKeys: handles missing sections", () => {
  const result = _parseSetupCfgKeys(`
[metadata]
name = my-package
version = 1.0
`);
  assert.equal(result.packageDir, null);
  assert.equal(result.packagesWhere, null);
});

test("parseSetupCfgKeys: handles comments and empty lines", () => {
  const result = _parseSetupCfgKeys(`
# This is a comment
; This is also a comment

[options]
# package_dir comment
package_dir = lib
`);
  assert.equal(result.packageDir, "lib");
  assert.equal(result.packagesWhere, null);
});

// ---------------------------------------------------------------------------
// §4.1 Package Index Builder
// ---------------------------------------------------------------------------

test("PackageIndex: flat-layout project indexes top-level modules", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "app.py", "import os");
    await writeProjectFile(root, "utils.py", "import sys");

    const index = await buildPackageIndex(root, "structural-heuristic");

    assert.equal(index.importRoot, root);
    assert.equal(index.rootConfidence, "structural-heuristic");

    // Root entry should exist with top-level modules
    const rootEntry = index.packages.get("");
    assert.ok(rootEntry, "Root entry should exist");
    assert.equal(rootEntry.kind, "namespace"); // No __init__.py at root
    assert.ok(rootEntry.modules.has("app"), "Should index app.py");
    assert.ok(rootEntry.modules.has("utils"), "Should index utils.py");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: regular package with __init__.py", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    await writeProjectFile(root, "mypackage/helpers.py", "import sys");

    const index = await buildPackageIndex(root, "declared");

    const pkg = index.packages.get("mypackage");
    assert.ok(pkg, "mypackage should be indexed");
    assert.equal(pkg.kind, "regular");
    assert.ok(pkg.initFile, "__init__.py should be tracked");
    assert.ok(pkg.initFile!.endsWith("__init__.py"));
    assert.ok(pkg.modules.has("core"), "core.py should be a module");
    assert.ok(pkg.modules.has("helpers"), "helpers.py should be a module");
    assert.ok(!pkg.modules.has("__init__"), "__init__.py should NOT be in modules");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: namespace package without __init__.py", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mynamespace/subpkg/__init__.py", "");
    await writeProjectFile(root, "mynamespace/subpkg/core.py", "import os");
    // mynamespace has no __init__.py — it's a namespace package
    // But it needs at least one .py file to be indexed...
    // Actually, it has a subdirectory with .py files but no .py files directly.
    // Per the spec: "A directory is added as a PythonPackageEntry if it
    // contains at least one .py file directly inside it."
    // So mynamespace/ would NOT be indexed (no direct .py files).
    // But mynamespace/subpkg/ would be indexed.

    const index = await buildPackageIndex(root, "structural-heuristic");

    // mynamespace itself should NOT be a package entry (no direct .py files)
    assert.equal(index.packages.has("mynamespace"), false);

    // But mynamespace.subpkg should be (it has __init__.py and core.py)
    const subpkg = index.packages.get("mynamespace.subpkg");
    assert.ok(subpkg, "mynamespace.subpkg should be indexed");
    assert.equal(subpkg.kind, "regular");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: namespace package with direct .py files", async () => {
  const root = await createTempProject();
  try {
    // A namespace package that has .py files but no __init__.py
    await writeProjectFile(root, "mynamespace/utils.py", "import os");
    await writeProjectFile(root, "mynamespace/helpers.py", "import sys");

    const index = await buildPackageIndex(root, "structural-heuristic");

    const ns = index.packages.get("mynamespace");
    assert.ok(ns, "mynamespace should be indexed");
    assert.equal(ns.kind, "namespace");
    assert.equal(ns.initFile, null);
    assert.ok(ns.modules.has("utils"));
    assert.ok(ns.modules.has("helpers"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: nested package structure", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    await writeProjectFile(root, "mypackage/utils/__init__.py", "");
    await writeProjectFile(root, "mypackage/utils/helpers.py", "import sys");
    await writeProjectFile(root, "mypackage/utils/formatters.py", "import re");

    const index = await buildPackageIndex(root, "declared");

    assert.ok(index.packages.has("mypackage"));
    assert.ok(index.packages.has("mypackage.utils"));

    const utils = index.packages.get("mypackage.utils")!;
    assert.equal(utils.kind, "regular");
    assert.ok(utils.modules.has("helpers"));
    assert.ok(utils.modules.has("formatters"));
    assert.equal(utils.modules.size, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: deterministic ordering", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "zebra/__init__.py", "");
    await writeProjectFile(root, "zebra/z.py", "");
    await writeProjectFile(root, "alpha/__init__.py", "");
    await writeProjectFile(root, "alpha/a.py", "");
    await writeProjectFile(root, "middle/__init__.py", "");
    await writeProjectFile(root, "middle/m.py", "");

    // Run twice and verify identical key ordering
    const index1 = await buildPackageIndex(root, "structural-heuristic");
    const index2 = await buildPackageIndex(root, "structural-heuristic");

    const keys1 = [...index1.packages.keys()];
    const keys2 = [...index2.packages.keys()];
    assert.deepEqual(keys1, keys2, "Package index key order should be deterministic");

    // Verify alphabetical ordering (alpha before middle before zebra)
    const packageKeys = keys1.filter(k => k !== "");
    assert.deepEqual(packageKeys, ["alpha", "middle", "zebra"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: name collision — directory takes precedence over file", async () => {
  const root = await createTempProject();
  try {
    // Both foo/bar.py AND foo/bar/ exist — directory wins
    await writeProjectFile(root, "foo/__init__.py", "");
    await writeProjectFile(root, "foo/bar.py", "# colliding file");
    await writeProjectFile(root, "foo/bar/__init__.py", "# directory package");
    await writeProjectFile(root, "foo/bar/baz.py", "import os");

    const index = await buildPackageIndex(root, "declared");

    const foo = index.packages.get("foo");
    assert.ok(foo);

    // foo.bar should NOT appear in foo's modules map (directory takes precedence)
    assert.ok(!foo.modules.has("bar"),
      "bar should not be in modules map because bar/ directory takes precedence");

    // But foo.bar as a package should exist
    const fooBar = index.packages.get("foo.bar");
    assert.ok(fooBar, "foo.bar should exist as a package");
    assert.equal(fooBar.kind, "regular");
    assert.ok(fooBar.modules.has("baz"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: excludes __pycache__ and .venv directories", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    // These should be excluded from the index
    await writeProjectFile(root, "mypackage/__pycache__/core.cpython-311.pyc", "compiled");
    await writeProjectFile(root, ".venv/lib/site-packages/requests/__init__.py", "");

    const index = await buildPackageIndex(root, "declared");

    // __pycache__ should never appear
    assert.ok(!index.packages.has("mypackage.__pycache__"));
    // .venv should never appear
    assert.ok(!index.packages.has(".venv"));
    // But mypackage should exist normally
    assert.ok(index.packages.has("mypackage"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: excludes .egg-info directories (suffix matching)", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    await writeProjectFile(root, "mypackage.egg-info/PKG-INFO", "Metadata-Version: 2.1");
    await writeProjectFile(root, "mypackage.egg-info/top_level.txt", "mypackage");

    const index = await buildPackageIndex(root, "declared");

    // .egg-info should be excluded
    assert.ok(!index.packages.has("mypackage.egg-info"));
    // mypackage should exist normally
    assert.ok(index.packages.has("mypackage"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PackageIndex: empty directory is not indexed as a package", async () => {
  const root = await createTempProject();
  try {
    await writeProjectFile(root, "mypackage/__init__.py", "");
    await writeProjectFile(root, "mypackage/core.py", "import os");
    // empty_dir has no .py files
    await mkdir(path.join(root, "mypackage", "empty_dir"), { recursive: true });

    const index = await buildPackageIndex(root, "declared");

    assert.ok(!index.packages.has("mypackage.empty_dir"),
      "Empty directory should not be indexed");
    assert.ok(index.packages.has("mypackage"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
