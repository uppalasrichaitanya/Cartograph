/**
 * Python Import Resolver
 *
 * Resolves raw import specifiers against the PythonPackageIndex to
 * classify each import as:
 *   1. Resolved-internal: lands on a real file in the project.
 *   2. Unresolved-internal: syntactically incapable of being external
 *      (relative imports, or absolute imports whose first segment matches
 *      a known top-level package) but does not resolve to a real file.
 *   3. External: everything else (stdlib, third-party).
 *
 * Resolution mechanics (from §4.1 of the milestone plan):
 *   - Absolute specifiers: look up the dotted path against `packages`
 *     in the PythonPackageIndex.
 *   - Relative specifiers: derive the importing file's package position
 *     from its path, walk up dot-levels, then resolve the remainder
 *     as an absolute lookup from that position.
 *
 * Determinism:
 *   Given the same package index and the same inputs, the output is
 *   always identical. No randomness, no OS-dependent ordering.
 *
 * @module lib/analysis/parsers/python/importResolver
 */

import path from "node:path";
import type { ParseFileInput, ResolvedSpecifier } from "../interface";
import type { PythonPackageIndex, PythonPackageEntry } from "./packageIndex";

// ---------------------------------------------------------------------------
// Relative Import Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw specifier into its dot-prefix level and module path.
 *
 * Examples:
 *   "os"          → { dotLevel: 0, modulePath: "os" }
 *   ".sibling"    → { dotLevel: 1, modulePath: "sibling" }
 *   "..cousin"    → { dotLevel: 2, modulePath: "cousin" }
 *   "..pkg.mod"   → { dotLevel: 2, modulePath: "pkg.mod" }
 *   "..."         → { dotLevel: 3, modulePath: "" }
 */
interface ParsedSpecifier {
  readonly dotLevel: number;
  readonly modulePath: string;
}

function parseSpecifier(specifier: string): ParsedSpecifier {
  let dotLevel = 0;
  while (dotLevel < specifier.length && specifier[dotLevel] === ".") {
    dotLevel++;
  }
  return {
    dotLevel,
    modulePath: specifier.slice(dotLevel),
  };
}

/**
 * Check if a specifier is syntactically relative (starts with dots).
 */
function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".");
}

// ---------------------------------------------------------------------------
// Package Position Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the importing file's package position (dotted path) from its
 * file path and the import root.
 *
 * The file's directory, relative to the import root, becomes its
 * package position. For example:
 *   importRoot = "/project/src"
 *   filePath   = "/project/src/mypackage/utils/helpers.py"
 *   → package position = "mypackage.utils"
 *
 * If the file is directly in the import root:
 *   filePath = "/project/src/main.py"
 *   → package position = "" (top-level)
 */
function derivePackagePosition(
  fileAbsolutePath: string,
  importRoot: string,
): string {
  const fileDir = path.dirname(fileAbsolutePath);
  const relativePath = path.relative(importRoot, fileDir);

  // If the file is directly in the import root, relative is "." or ""
  if (relativePath === "." || relativePath === "") {
    return "";
  }

  // Convert OS path separators to dots
  return relativePath.split(path.sep).join(".");
}

/**
 * Walk up `levels` segments from a dotted package position.
 *
 * Examples:
 *   walkUp("mypackage.utils.helpers", 1) → "mypackage.utils"
 *   walkUp("mypackage.utils.helpers", 2) → "mypackage"
 *   walkUp("mypackage.utils.helpers", 3) → ""
 *   walkUp("mypackage", 1) → ""
 *   walkUp("mypackage", 2) → null  (walked past root)
 */
function walkUp(dottedPath: string, levels: number): string | null {
  if (dottedPath === "") {
    // Already at root — can't walk up further
    return levels === 0 ? "" : null;
  }

  const segments = dottedPath.split(".");
  if (levels > segments.length) {
    return null; // Walked past the project root
  }
  if (levels === segments.length) {
    return "";
  }
  return segments.slice(0, segments.length - levels).join(".");
}

// ---------------------------------------------------------------------------
// Resolution Logic
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve a dotted module path against the package index,
 * starting from a given base position.
 *
 * The full lookup path is:
 *   baseDotted === "" ? modulePath : baseDotted + "." + modulePath
 *
 * Resolution priority (from §4.1):
 *   1. Check if the full path matches a module in a package's modules map.
 *   2. Check if the full path matches a package entry (directory).
 *      If the package is regular (has __init__.py), resolve to the init file.
 *      If the package is namespace, no single file — cannot create a file edge.
 *
 * @returns The project-relative path to the resolved file, or null.
 */
function lookupInIndex(
  packages: ReadonlyMap<string, PythonPackageEntry>,
  fullDottedPath: string,
  importRoot: string,
  projectRoot: string,
): string | null {
  // Split "foo.bar.baz" into package part "foo.bar" and module part "baz"
  const lastDot = fullDottedPath.lastIndexOf(".");
  if (lastDot >= 0) {
    const packagePath = fullDottedPath.slice(0, lastDot);
    const moduleName = fullDottedPath.slice(lastDot + 1);

    // Look for the module in the package's modules map
    const pkg = packages.get(packagePath);
    if (pkg) {
      const moduleAbsPath = pkg.modules.get(moduleName);
      if (moduleAbsPath) {
        return toProjectRelative(moduleAbsPath, projectRoot);
      }
    }
  } else {
    // No dots — this is a top-level module name
    // Check if it's a module in the root package entry
    const rootPkg = packages.get("");
    if (rootPkg) {
      const moduleAbsPath = rootPkg.modules.get(fullDottedPath);
      if (moduleAbsPath) {
        return toProjectRelative(moduleAbsPath, projectRoot);
      }
    }
  }

  // Check if the full path matches a package entry (directory import)
  const pkg = packages.get(fullDottedPath);
  if (pkg && pkg.kind === "regular" && pkg.initFile) {
    return toProjectRelative(pkg.initFile, projectRoot);
  }

  // Namespace package — exists as a package but has no __init__.py,
  // so there's no single file to point to. This is a valid internal
  // reference but not resolvable to a file-level edge.
  // We return null and let the caller decide if it's unresolved-internal.

  return null;
}

/**
 * Convert an absolute file path to a project-relative path with forward slashes.
 */
function toProjectRelative(absolutePath: string, projectRoot: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

/**
 * Check if the first segment of a dotted specifier matches any known
 * top-level package in the index.
 *
 * Used to determine if an absolute import is "plausibly internal"
 * (its first segment matches a known package), which affects
 * unresolved-internal classification.
 */
function firstSegmentMatchesKnownPackage(
  specifier: string,
  packages: ReadonlyMap<string, PythonPackageEntry>,
): boolean {
  const firstDot = specifier.indexOf(".");
  const firstSegment = firstDot >= 0 ? specifier.slice(0, firstDot) : specifier;

  // Check if this first segment is a known top-level package
  if (packages.has(firstSegment)) {
    return true;
  }

  // Also check if it's a top-level module in the root package
  const rootPkg = packages.get("");
  if (rootPkg && rootPkg.modules.has(firstSegment)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a raw Python import specifier.
 *
 * Implements the three-outcome classification from §4.1:
 *   1. Resolved-internal: { resolved: "path/to/file.py", raw }
 *   2. Unresolved-internal: { resolved: null, raw, unresolvedKind: "unresolved-internal" }
 *   3. External: { resolved: null, raw, unresolvedKind: "external" }
 *
 * @param specifier   - Raw import specifier (e.g., "os", ".utils", "..models.base")
 * @param fromFile    - The file containing the import
 * @param packageIndex - The project's package index
 * @param projectRoot  - Absolute path to the project root
 */
export function resolveImport(
  specifier: string,
  fromFile: ParseFileInput,
  packageIndex: PythonPackageIndex,
  projectRoot: string,
): ResolvedSpecifier {
  const { packages, importRoot } = packageIndex;

  // __future__ is always external (it's a stdlib pseudo-module)
  if (specifier === "__future__") {
    return { resolved: null, raw: specifier, unresolvedKind: "external" };
  }

  if (isRelativeSpecifier(specifier)) {
    return resolveRelative(specifier, fromFile, packages, importRoot, projectRoot);
  }

  return resolveAbsolute(specifier, packages, importRoot, projectRoot);
}

/**
 * Resolve a relative import specifier.
 *
 * Relative imports are ALWAYS internal (they're syntactically incapable
 * of referring to external packages). If resolution fails, the result
 * is unresolved-internal, never external.
 */
function resolveRelative(
  specifier: string,
  fromFile: ParseFileInput,
  packages: ReadonlyMap<string, PythonPackageEntry>,
  importRoot: string,
  projectRoot: string,
): ResolvedSpecifier {
  const { dotLevel, modulePath } = parseSpecifier(specifier);

  // Derive the importing file's package position
  const filePackagePosition = derivePackagePosition(fromFile.absolutePath, importRoot);

  // Walk up `dotLevel - 1` levels from the file's package position.
  // Why -1? Because `from . import X` means "from the current package",
  // not "from the parent package". One dot = current package level.
  // Two dots = parent package. etc.
  const basePath = walkUp(filePackagePosition, dotLevel - 1);

  if (basePath === null) {
    // Walked past the project root — cannot resolve
    return {
      resolved: null,
      raw: specifier,
      unresolvedKind: "unresolved-internal",
    };
  }

  // Build the full dotted path to look up
  const fullPath = basePath && modulePath
    ? `${basePath}.${modulePath}`
    : basePath || modulePath;

  if (!fullPath) {
    // Bare relative import with no module path and at root level
    // e.g., `from . import something` at the top level
    return {
      resolved: null,
      raw: specifier,
      unresolvedKind: "unresolved-internal",
    };
  }

  const resolved = lookupInIndex(packages, fullPath, importRoot, projectRoot);
  if (resolved !== null) {
    return { resolved, raw: specifier };
  }

  // Relative imports that don't resolve are unresolved-internal, never external
  return {
    resolved: null,
    raw: specifier,
    unresolvedKind: "unresolved-internal",
  };
}

/**
 * Resolve an absolute import specifier.
 *
 * If the first segment matches a known top-level package, a failed
 * resolution is classified as unresolved-internal (the import is
 * plausibly targeting project code but the specific file doesn't exist).
 * Otherwise, it's classified as external.
 */
function resolveAbsolute(
  specifier: string,
  packages: ReadonlyMap<string, PythonPackageEntry>,
  importRoot: string,
  projectRoot: string,
): ResolvedSpecifier {
  const resolved = lookupInIndex(packages, specifier, importRoot, projectRoot);
  if (resolved !== null) {
    return { resolved, raw: specifier };
  }

  // Check if this is plausibly internal (first segment matches a known package)
  if (firstSegmentMatchesKnownPackage(specifier, packages)) {
    return {
      resolved: null,
      raw: specifier,
      unresolvedKind: "unresolved-internal",
    };
  }

  // No match at all — external import (stdlib or third-party)
  return {
    resolved: null,
    raw: specifier,
    unresolvedKind: "external",
  };
}

// ---------------------------------------------------------------------------
// Test-visible exports
// ---------------------------------------------------------------------------

export {
  parseSpecifier as _parseSpecifier,
  derivePackagePosition as _derivePackagePosition,
  walkUp as _walkUp,
  firstSegmentMatchesKnownPackage as _firstSegmentMatchesKnownPackage,
};
