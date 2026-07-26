/**
 * Python Parser — Phase 3 Unit Tests (Tree-sitter Integration & Parsing)
 *
 * Tests the parseFile() implementation using tree-sitter-python WASM.
 * Covers import extraction for all Python import forms, syntax error
 * handling, deduplication, determinism, empty/comment-only files, and
 * edge cases.
 *
 * These tests exercise the parser through the LanguageParser interface
 * contract. The tree-sitter WASM runtime is loaded once before all tests
 * via PythonParser.initialize().
 *
 * @module tests/python/parseFile.test
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
  return mkdtemp(path.join(tmpdir(), "cartograph-py-parse-test-"));
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

function makeFile(root: string, relPath: string): ParseFileInput {
  return {
    absolutePath: path.join(root, ...relPath.split("/")),
    relativePath: relPath,
  };
}

// ---------------------------------------------------------------------------
// Shared setup: create a temp project and initialize a parser once
// ---------------------------------------------------------------------------

let testRoot: string;
let parser: PythonParser;

// Initialize once for all tests — loading WASM is expensive (~100ms),
// we don't want to pay it per test.
test("Phase 3: setup — initialize parser with tree-sitter", async () => {
  testRoot = await createTempProject();
  await writeProjectFile(testRoot, "stub.py", "");
  parser = new PythonParser();
  await parser.initialize(makeContext(testRoot, ["stub.py"]));
});

// ---------------------------------------------------------------------------
// Basic Absolute Imports
// ---------------------------------------------------------------------------

test("parseFile: simple import statement", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "import os\n");

  assert.deepEqual([...result.internalImports], ["os"]);
  assert.deepEqual([...result.externalImports], []);
  assert.deepEqual([...result.parseErrors], []);
  assert.equal(result.path, "app.py");
  assert.deepEqual([...result.capabilitiesUsed], ["imports"]);
});

test("parseFile: dotted import (import foo.bar.baz)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "import foo.bar.baz\n");

  assert.deepEqual([...result.internalImports], ["foo.bar.baz"]);
});

test("parseFile: multiple imports on one line (import a, b, c)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "import a, b, c\n");

  assert.deepEqual([...result.internalImports], ["a", "b", "c"]);
});

test("parseFile: aliased import (import foo as f)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "import foo as f\nimport bar.baz as bb\n");

  assert.deepEqual([...result.internalImports], ["foo", "bar.baz"]);
});

// ---------------------------------------------------------------------------
// From-Import Statements
// ---------------------------------------------------------------------------

test("parseFile: from-import (from foo import bar)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "from foo import bar\n");

  assert.deepEqual([...result.internalImports], ["foo"]);
});

test("parseFile: from-import multi (from foo import a, b, c)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "from foo import a, b, c\n");

  // All three imports are from the same module "foo" — one specifier
  assert.deepEqual([...result.internalImports], ["foo"]);
});

test("parseFile: from-import parenthesized (from foo import (a, b, c))", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "from foo import (a, b, c)\n");

  assert.deepEqual([...result.internalImports], ["foo"]);
});

test("parseFile: from-import dotted module (from foo.bar import baz)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "from foo.bar import baz\n");

  assert.deepEqual([...result.internalImports], ["foo.bar"]);
});

test("parseFile: from-import aliased (from foo import bar as baz)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "from foo import bar as baz\n");

  assert.deepEqual([...result.internalImports], ["foo"]);
});

// ---------------------------------------------------------------------------
// Star Imports (§2.6)
// ---------------------------------------------------------------------------

test("parseFile: star import (from foo import *)", () => {
  const file = makeFile(testRoot, "app.py");
  const result = parser.parseFile(file, "from foo import *\n");

  // Star import creates a dependency on module "foo"
  assert.deepEqual([...result.internalImports], ["foo"]);
});

// ---------------------------------------------------------------------------
// Relative Imports (§2.2)
// ---------------------------------------------------------------------------

test("parseFile: relative import — single dot (from . import sibling)", () => {
  const file = makeFile(testRoot, "pkg/mod.py");
  const result = parser.parseFile(file, "from . import sibling\n");

  assert.deepEqual([...result.internalImports], [".sibling"]);
});

test("parseFile: relative import — double dot (from .. import cousin)", () => {
  const file = makeFile(testRoot, "pkg/sub/mod.py");
  const result = parser.parseFile(file, "from .. import cousin\n");

  assert.deepEqual([...result.internalImports], ["..cousin"]);
});

test("parseFile: relative import — triple dot (from ... import deep)", () => {
  const file = makeFile(testRoot, "a/b/c/mod.py");
  const result = parser.parseFile(file, "from ... import deep\n");

  assert.deepEqual([...result.internalImports], ["...deep"]);
});

test("parseFile: relative import with module path (from .sub import thing)", () => {
  const file = makeFile(testRoot, "pkg/mod.py");
  const result = parser.parseFile(file, "from .sub import thing\n");

  assert.deepEqual([...result.internalImports], [".sub"]);
});

test("parseFile: relative import — double dot with module path (from ..pkg.mod import func)", () => {
  const file = makeFile(testRoot, "a/b/mod.py");
  const result = parser.parseFile(file, "from ..pkg.mod import func\n");

  assert.deepEqual([...result.internalImports], ["..pkg.mod"]);
});

test("parseFile: relative import — multiple names (from . import a, b, c)", () => {
  const file = makeFile(testRoot, "pkg/mod.py");
  const result = parser.parseFile(file, "from . import a, b, c\n");

  // Each imported name from a bare relative creates a separate specifier
  assert.deepEqual([...result.internalImports], [".a", ".b", ".c"]);
});

test("parseFile: relative import with alias (from . import a as x)", () => {
  const file = makeFile(testRoot, "pkg/mod.py");
  const result = parser.parseFile(file, "from . import a as x\n");

  // Alias is ignored, specifier is ".a"
  assert.deepEqual([...result.internalImports], [".a"]);
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

test("parseFile: duplicate imports are deduplicated", () => {
  const file = makeFile(testRoot, "app.py");
  const code = `
import os
import sys
import os
from os import path
from sys import argv
`;
  const result = parser.parseFile(file, code);

  // "os" appears twice as `import os`, once as `from os import path`.
  // All three refer to module "os" — deduplicated to one.
  assert.deepEqual([...result.internalImports], ["os", "sys"]);
});

test("parseFile: different dotted paths are not deduplicated", () => {
  const file = makeFile(testRoot, "app.py");
  const code = `
import foo
import foo.bar
import foo.bar.baz
from foo.bar import x
`;
  const result = parser.parseFile(file, code);

  // "foo", "foo.bar", "foo.bar.baz" are three different modules
  // "from foo.bar import x" deduplicates with "import foo.bar"
  assert.deepEqual([...result.internalImports], ["foo", "foo.bar", "foo.bar.baz"]);
});

// ---------------------------------------------------------------------------
// Empty Files and Comments
// ---------------------------------------------------------------------------

test("parseFile: empty file", () => {
  const file = makeFile(testRoot, "empty.py");
  const result = parser.parseFile(file, "");

  assert.deepEqual([...result.internalImports], []);
  assert.deepEqual([...result.parseErrors], []);
  assert.equal(result.lineCount, 1);
});

test("parseFile: file with only comments", () => {
  const file = makeFile(testRoot, "comments.py");
  const code = `# This is a comment
# Another comment
# import os  <-- not a real import
`;
  const result = parser.parseFile(file, code);

  assert.deepEqual([...result.internalImports], []);
});

test("parseFile: file with docstring only", () => {
  const file = makeFile(testRoot, "docstring.py");
  const code = `"""
This module does nothing.

Usage:
    import this_is_not_an_import
"""
`;
  const result = parser.parseFile(file, code);

  assert.deepEqual([...result.internalImports], []);
});

test("parseFile: imports mixed with comments and docstrings", () => {
  const file = makeFile(testRoot, "mixed.py");
  const code = `"""Module docstring."""
# Standard library imports
import os
import sys

# Third-party imports
# import numpy  <-- commented out
from pathlib import Path

# Local imports
from . import utils
`;
  const result = parser.parseFile(file, code);

  assert.deepEqual([...result.internalImports], ["os", "sys", "pathlib", ".utils"]);
});

// ---------------------------------------------------------------------------
// Syntax Errors
// ---------------------------------------------------------------------------

test("parseFile: syntax error produces parse errors", () => {
  const file = makeFile(testRoot, "bad.py");
  const code = `from import
import
def broken(
`;
  const result = parser.parseFile(file, code);

  assert.ok(result.parseErrors.length > 0, "Should have parse errors");
  assert.equal(result.parseErrors[0].severity, "partial");
  assert.equal(result.parseErrors[0].reason, "syntax");
});

test("parseFile: file with syntax errors still extracts valid imports", () => {
  const file = makeFile(testRoot, "partial.py");
  const code = `import os
invalid syntax error blah
import sys
`;
  const result = parser.parseFile(file, code);

  // Tree-sitter performs error recovery — it should still extract
  // valid imports from the non-error parts of the tree
  const imports = [...result.internalImports];
  assert.ok(imports.includes("os"), "Should extract 'os' despite error");
  assert.ok(imports.includes("sys"), "Should extract 'sys' despite error");
});

// ---------------------------------------------------------------------------
// Nested Imports (inside functions/classes)
// ---------------------------------------------------------------------------

test("parseFile: imports inside function bodies are extracted", () => {
  const file = makeFile(testRoot, "nested.py");
  const code = `
import top_level

def my_function():
    import inside_function
    from os import path

class MyClass:
    import inside_class
`;
  const result = parser.parseFile(file, code);

  const imports = [...result.internalImports];
  assert.ok(imports.includes("top_level"));
  assert.ok(imports.includes("inside_function"));
  assert.ok(imports.includes("os"));
  assert.ok(imports.includes("inside_class"));
});

test("parseFile: conditional imports are extracted", () => {
  const file = makeFile(testRoot, "conditional.py");
  const code = `
import always

try:
    import optional_dep
except ImportError:
    import fallback_dep

if True:
    from conditional import thing
`;
  const result = parser.parseFile(file, code);

  const imports = [...result.internalImports];
  assert.ok(imports.includes("always"));
  assert.ok(imports.includes("optional_dep"));
  assert.ok(imports.includes("fallback_dep"));
  assert.ok(imports.includes("conditional"));
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("parseFile: deterministic output — same input produces same output", () => {
  const file = makeFile(testRoot, "determinism.py");
  const code = `
import zebra
from alpha import beta
import middle
from . import relative
from ..parent import child
`;

  const result1 = parser.parseFile(file, code);
  const result2 = parser.parseFile(file, code);

  assert.deepEqual([...result1.internalImports], [...result2.internalImports]);
  assert.equal(result1.lineCount, result2.lineCount);
  assert.deepEqual([...result1.parseErrors], [...result2.parseErrors]);
});

test("parseFile: specifiers are in source order", () => {
  const file = makeFile(testRoot, "order.py");
  const code = `
import z_module
import a_module
import m_module
from x_pkg import thing
`;
  const result = parser.parseFile(file, code);

  // Source order, NOT alphabetical
  assert.deepEqual([...result.internalImports], [
    "z_module",
    "a_module",
    "m_module",
    "x_pkg",
  ]);
});

// ---------------------------------------------------------------------------
// Line Count
// ---------------------------------------------------------------------------

test("parseFile: correct line count", () => {
  const file = makeFile(testRoot, "lines.py");

  // 3 lines of content + trailing newline = 4 lines
  assert.equal(parser.parseFile(file, "a\nb\nc\n").lineCount, 4);

  // 1 line, no trailing newline
  assert.equal(parser.parseFile(file, "a").lineCount, 1);

  // Empty file
  assert.equal(parser.parseFile(file, "").lineCount, 1);

  // Windows line endings
  assert.equal(parser.parseFile(file, "a\r\nb\r\nc\r\n").lineCount, 4);
});

// ---------------------------------------------------------------------------
// Complex Real-World Patterns
// ---------------------------------------------------------------------------

test("parseFile: real-world import block", () => {
  const file = makeFile(testRoot, "real_world.py");
  const code = `#!/usr/bin/env python3
"""A realistic Python module with mixed imports."""

from __future__ import annotations

import os
import sys
import json
from pathlib import Path
from typing import Optional, Dict, List
from collections.abc import Sequence

# Third-party
from flask import Flask, request, jsonify
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

# Local
from . import config
from .models import User, Post
from ..utils.logging import get_logger
`;
  const result = parser.parseFile(file, code);

  const imports = [...result.internalImports];
  assert.deepEqual(imports, [
    "__future__",
    "os",
    "sys",
    "json",
    "pathlib",
    "typing",
    "collections.abc",
    "flask",
    "sqlalchemy",
    "sqlalchemy.orm",
    ".config",
    ".models",
    "..utils.logging",
  ]);
  assert.deepEqual([...result.parseErrors], []);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test("Phase 3: teardown — dispose parser and clean temp", async () => {
  parser.dispose();
  await rm(testRoot, { recursive: true, force: true });
});
