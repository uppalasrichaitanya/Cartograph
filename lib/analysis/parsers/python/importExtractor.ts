/**
 * Python Import Extraction — AST Walker
 *
 * Extracts import specifiers from a tree-sitter Python syntax tree.
 * Produces raw, unresolved specifier strings. Resolution is deferred
 * to Phase 4 (`resolveImport()`).
 *
 * Supported import forms:
 *   - `import foo`              → specifier: "foo"
 *   - `import foo.bar.baz`      → specifier: "foo.bar.baz"
 *   - `import foo as f`         → specifier: "foo" (alias ignored)
 *   - `import a, b, c`          → specifiers: "a", "b", "c"
 *   - `from foo import bar`     → specifier: "foo"
 *   - `from foo import *`       → specifier: "foo"
 *   - `from foo import (a, b)`  → specifier: "foo"
 *   - `from . import sibling`   → specifier: ".sibling"
 *   - `from .. import cousin`   → specifier: "..cousin"
 *   - `from .sub import thing`  → specifier: ".sub"
 *   - `from ..pkg import func`  → specifier: "..pkg"
 *
 * Specifier semantics:
 *   For `import X` statements, the specifier is the full dotted name
 *   (the module being imported).
 *   For `from X import Y` statements, the specifier is X (the module
 *   being imported from), NOT X.Y — consistent with how Python's import
 *   machinery resolves: `from foo.bar import baz` imports `baz` from
 *   `foo.bar`, creating a dependency on the `foo.bar` module/package.
 *
 * Relative import encoding:
 *   Relative imports are encoded with leading dots preserved in the
 *   specifier string. The number of dots indicates the level of
 *   relative traversal. Phase 4's `resolveImport()` will interpret
 *   these dots using the importing file's package position.
 *
 * Determinism:
 *   Specifiers are collected in source-order (tree-sitter's natural
 *   traversal order), then deduplicated via a Set. The final array
 *   preserves first-occurrence order — deterministic for identical input.
 *
 * @module lib/analysis/parsers/python/importExtractor
 */

import type { Node, Tree } from "./treeSitter";
import type { IRParseError } from "../interface";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of extracting imports from a Python source file.
 */
export interface PythonExtractionResult {
  /** Raw import specifiers, deduplicated, in source order. */
  readonly specifiers: string[];
  /** Syntax errors found in the tree, if any. */
  readonly parseErrors: IRParseError[];
}

// ---------------------------------------------------------------------------
// AST Node Handlers
// ---------------------------------------------------------------------------

/**
 * Extract the module specifier from an `import_statement` node.
 *
 * Handles:
 *   - `import foo`           → ["foo"]
 *   - `import foo.bar.baz`   → ["foo.bar.baz"]
 *   - `import a, b, c`       → ["a", "b", "c"]
 *   - `import a as x, b as y`→ ["a", "b"] (aliases ignored)
 *
 * Returns the dotted name(s) of the imported module(s).
 */
function extractFromImportStatement(node: Node): string[] {
  const specifiers: string[] = [];

  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === "dotted_name") {
      // Simple import: `import foo` or `import foo.bar`
      specifiers.push(child.text);
    } else if (child.type === "aliased_import") {
      // Aliased import: `import foo as f`
      // The `name` field contains the actual module name
      const name = child.childForFieldName("name");
      if (name) {
        specifiers.push(name.text);
      }
    }
  }

  return specifiers;
}

/**
 * Extract the module specifier from an `import_from_statement` node.
 *
 * Handles:
 *   - `from foo import bar`       → "foo"
 *   - `from foo.bar import baz`   → "foo.bar"
 *   - `from foo import *`         → "foo"
 *   - `from foo import (a, b, c)` → "foo"
 *   - `from . import sibling`     → ".sibling"
 *   - `from .. import cousin`     → "..cousin"
 *   - `from .sub import thing`    → ".sub"
 *   - `from ..pkg.mod import f`   → "..pkg.mod"
 *
 * For relative imports, the specifier encodes the dot-prefix and the
 * module path. For bare relative imports (`from . import X`), the
 * imported name(s) are appended as the "module" part: `from . import foo`
 * creates a dependency on `.foo` (the sibling module `foo`).
 *
 * Returns a single specifier string, or null if the node is malformed.
 */
function extractFromImportFromStatement(node: Node): string[] {
  const moduleNameNode = node.childForFieldName("module_name");
  if (!moduleNameNode) return [];

  if (moduleNameNode.type === "dotted_name") {
    // Absolute import: `from foo.bar import baz`
    const specifiers: string[] = [];
    const nameNodes = node.childrenForFieldName("name");
    let hasNames = false;
    for (const nameNode of nameNodes) {
      if (!nameNode) continue;
      hasNames = true;
      if (nameNode.type === "dotted_name") {
        specifiers.push(`${moduleNameNode.text}.${nameNode.text}`);
      } else if (nameNode.type === "aliased_import") {
        const name = nameNode.childForFieldName("name");
        if (name) {
          specifiers.push(`${moduleNameNode.text}.${name.text}`);
        }
      }
    }
    if (!hasNames) {
      specifiers.push(moduleNameNode.text);
    }
    return specifiers;
  }

  if (moduleNameNode.type === "relative_import") {
    // Relative import: `from . import X` or `from ..pkg import Y`
    return extractFromRelativeImport(moduleNameNode, node);
  }

  return [];
}

/**
 * Extract specifier(s) from a `relative_import` node.
 *
 * A relative_import node has children:
 *   - import_prefix: the dots (e.g. ".", "..", "...")
 *   - dotted_name (optional): the module path after the dots
 *
 * For `from . import foo, bar`:
 *   The import_prefix is "." and there's no dotted_name child.
 *   The imported names (foo, bar) are at the import_from_statement level.
 *   Each becomes a separate specifier: ".foo", ".bar"
 *
 * For `from .sub import thing`:
 *   The import_prefix is "." and dotted_name is "sub".
 *   The specifier is ".sub" (the imported name "thing" is not part
 *   of the module path).
 *
 * @param relNode  - The relative_import AST node
 * @param fromNode - The parent import_from_statement node
 */
function extractFromRelativeImport(relNode: Node, fromNode: Node): string[] {
  let prefix = "";
  let modulePath = "";

  for (const child of relNode.namedChildren) {
    if (!child) continue;
    if (child.type === "import_prefix") {
      prefix = child.text; // ".", "..", "...", etc.
    } else if (child.type === "dotted_name") {
      modulePath = child.text;
    }
  }

  // If there's a module path after the dots, the specifier is dots + path
  // e.g. `from .sub import thing` → ".sub.thing"
  // e.g. `from ..pkg.mod import func` → "..pkg.mod.func"
  const nameNodes = fromNode.childrenForFieldName("name");
  if (modulePath) {
    const specifiers: string[] = [];
    let hasNames = false;
    for (const nameNode of nameNodes) {
      if (!nameNode) continue;
      hasNames = true;
      if (nameNode.type === "dotted_name") {
        specifiers.push(`${prefix}${modulePath}.${nameNode.text}`);
      } else if (nameNode.type === "aliased_import") {
        const name = nameNode.childForFieldName("name");
        if (name) {
          specifiers.push(`${prefix}${modulePath}.${name.text}`);
        }
      }
    }
    if (!hasNames) {
      specifiers.push(`${prefix}${modulePath}`);
    }
    return specifiers;
  }

  // Bare relative import: `from . import foo, bar`
  // Each imported name becomes its own specifier
  // e.g. `from . import foo` → ".foo"
  // e.g. `from .. import a, b` → "..a", "..b"
  const specifiers: string[] = [];
  for (const nameNode of nameNodes) {
    if (!nameNode) continue;
    if (nameNode.type === "dotted_name") {
      specifiers.push(`${prefix}${nameNode.text}`);
    } else if (nameNode.type === "aliased_import") {
      const name = nameNode.childForFieldName("name");
      if (name) {
        specifiers.push(`${prefix}${name.text}`);
      }
    }
  }

  return specifiers;
}

// ---------------------------------------------------------------------------
// Error Extraction
// ---------------------------------------------------------------------------

/**
 * Collect syntax errors from the tree-sitter parse tree.
 *
 * Tree-sitter represents syntax errors as ERROR nodes in the tree.
 * We walk only top-level ERROR nodes (not nested ones inside valid
 * subtrees) to avoid duplicate reporting.
 *
 * @param rootNode - The root node of the syntax tree
 */
function collectParseErrors(rootNode: Node): IRParseError[] {
  const errors: IRParseError[] = [];

  if (!rootNode.hasError) return errors;

  const visit = (node: Node) => {
    if (node.isError) {
      const startPos = node.startPosition;
      errors.push({
        message: `Syntax error at line ${startPos.row + 1}, column ${startPos.column + 1}`,
        line: startPos.row + 1,    // Convert 0-based to 1-based
        column: startPos.column + 1,
        severity: "partial",       // Not "fatal" — tree-sitter recovers and
        reason: "syntax",           // we can still extract imports from valid parts
      });
      return; // Stop recursing into this error to avoid duplicates
    }

    if (node.hasError) {
      for (const child of node.children) {
        if (!child) continue;
        visit(child);
      }
    }
  };

  visit(rootNode);
  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all import specifiers from a parsed Python syntax tree.
 *
 * Walks the tree's top-level children and extracts import specifiers
 * from `import_statement` and `import_from_statement` nodes.
 *
 * Specifiers are deduplicated (same module imported multiple times
 * in the same file → single specifier) and returned in first-occurrence
 * order.
 *
 * @param tree - The tree-sitter syntax tree
 * @returns Extracted specifiers and any parse errors
 */
export function extractImports(tree: Tree): PythonExtractionResult {
  const rootNode = tree.rootNode;
  const seen = new Set<string>();
  const specifiers: string[] = [];

  // Walk top-level statements only.
  // Python import statements are always at the module level (not inside
  // function bodies) by convention, but they *can* appear inside functions
  // or classes. For a structural dependency graph, we want ALL imports
  // regardless of nesting level — a conditional import inside a function
  // is still a dependency.
  const visit = (node: Node): void => {
    if (node.type === "import_statement") {
      for (const spec of extractFromImportStatement(node)) {
        if (!seen.has(spec)) {
          seen.add(spec);
          specifiers.push(spec);
        }
      }
      return; // Don't recurse into import statement children
    }

    if (node.type === "import_from_statement") {
      for (const spec of extractFromImportFromStatement(node)) {
        if (!seen.has(spec)) {
          seen.add(spec);
          specifiers.push(spec);
        }
      }
      return; // Don't recurse into import statement children
    }

    if (node.type === "future_import_statement") {
      if (!seen.has("__future__")) {
        seen.add("__future__");
        specifiers.push("__future__");
      }
      return;
    }

    // Recurse into non-import nodes to find nested imports
    for (const child of node.namedChildren) {
      if (!child) continue;
      visit(child);
    }
  };

  visit(rootNode);

  const parseErrors = collectParseErrors(rootNode);

  return { specifiers, parseErrors };
}
