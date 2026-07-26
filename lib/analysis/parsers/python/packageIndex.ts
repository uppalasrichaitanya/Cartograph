/**
 * Python Package Index Builder
 *
 * Constructs a `PythonPackageIndex` by walking the import root directory
 * tree. The index maps dotted Python package paths to their directory
 * entries, including regular packages (with `__init__.py`) and namespace
 * packages (without `__init__.py`, PEP 420).
 *
 * The walk is deterministic: directories are sorted lexicographically
 * at each level, matching the determinism guarantee established in
 * Milestone 1 for IDs and graph ordering.
 *
 * Design decisions (from §4.1 of the milestone plan):
 *   - A directory is indexed if it contains at least one `.py` file
 *     directly (not recursively). Presence of `__init__.py` determines
 *     `kind`, not eligibility.
 *   - `modules` maps module names (filename without `.py`) to absolute
 *     file paths. `__init__.py` is excluded from `modules` (it's
 *     referenced via `initFile`).
 *   - Name collisions (directory `foo/bar/` vs. file `foo/bar.py`)
 *     are resolved deterministically: directory takes precedence.
 *
 * Created as part of Milestone 3, Phase 1 (Metadata & Root Detection).
 *
 * @module lib/analysis/parsers/python/packageIndex
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The complete package index for a Python project.
 * Built once during `initialize()`, retained for `resolveImport()`.
 */
export interface PythonPackageIndex {
  /** Absolute path to the import root, per §3.1. */
  readonly importRoot: string;
  /** Which heuristic step produced this root. */
  readonly rootConfidence: "declared" | "structural-heuristic";
  /**
   * All discovered packages, keyed by dotted path.
   * Example key: "mypackage.utils"
   */
  readonly packages: ReadonlyMap<string, PythonPackageEntry>;
}

/**
 * A single Python package (directory) in the index.
 */
export interface PythonPackageEntry {
  /** Dotted import path, e.g. "mypackage.utils". */
  readonly dottedPath: string;
  /** Absolute path to the directory on disk. */
  readonly directoryPath: string;
  /** Whether this package has an `__init__.py` (regular) or not (namespace). */
  readonly kind: "regular" | "namespace";
  /** Absolute path to `__init__.py`, or null for namespace packages. */
  readonly initFile: string | null;
  /**
   * Modules (`.py` files) directly in this package directory.
   * Key: module name (filename without `.py`).
   * Value: absolute path to the `.py` file.
   * `__init__.py` is excluded (referenced via `initFile`).
   */
  readonly modules: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a PythonPackageIndex by walking the import root.
 *
 * The walk is deterministic:
 *   - Directories at each level are sorted lexicographically
 *   - Files within a directory are sorted lexicographically
 *   - The walk is pre-order (parent packages before child packages)
 *
 * @param importRoot     - Absolute path to the import root directory
 * @param rootConfidence - Which heuristic produced this root
 */
export async function buildPackageIndex(
  importRoot: string,
  rootConfidence: "declared" | "structural-heuristic",
): Promise<PythonPackageIndex> {
  const packages = new Map<string, PythonPackageEntry>();

  /**
   * Walk a directory, building package entries for each directory
   * that contains at least one `.py` file.
   *
   * @param dirPath    - Absolute path to the directory to walk
   * @param dottedBase - The dotted path prefix for this directory
   *                     (empty string for the import root itself)
   */
  async function walk(dirPath: string, dottedBase: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // Unreadable directory — skip silently
    }

    // Sort entries lexicographically for determinism
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Separate files and directories
    const pyFiles: string[] = [];
    const subdirs: string[] = [];
    let hasInit = false;

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".py")) {
        if (entry.name === "__init__.py") {
          hasInit = true;
        } else {
          pyFiles.push(entry.name);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith(".") && !isExcludedDir(entry.name)) {
        subdirs.push(entry.name);
      }
    }

    // A directory is a package if it contains at least one .py file
    // (__init__.py counts as a .py file for this purpose)
    const hasPythonFiles = hasInit || pyFiles.length > 0;

    if (hasPythonFiles && dottedBase !== "") {
      // Build the modules map
      const modules = new Map<string, string>();

      // Track directory names at this level for name-collision handling
      const subdirNames = new Set(subdirs);

      for (const fileName of pyFiles) {
        const moduleName = fileName.slice(0, -3); // Remove ".py"

        // Name-collision edge case (§4.1 rule 5):
        // If a directory with the same name exists, the directory takes
        // precedence — skip the file as a module entry.
        if (subdirNames.has(moduleName)) {
          continue;
        }

        modules.set(moduleName, path.join(dirPath, fileName));
      }

      const entry: PythonPackageEntry = {
        dottedPath: dottedBase,
        directoryPath: dirPath,
        kind: hasInit ? "regular" : "namespace",
        initFile: hasInit ? path.join(dirPath, "__init__.py") : null,
        modules,
      };

      packages.set(dottedBase, entry);
    }

    // Also handle the import root itself — if it has .py files,
    // they are top-level modules (no package prefix)
    if (hasPythonFiles && dottedBase === "") {
      const modules = new Map<string, string>();
      const subdirNames = new Set(subdirs);

      for (const fileName of pyFiles) {
        const moduleName = fileName.slice(0, -3);
        if (subdirNames.has(moduleName)) continue;
        modules.set(moduleName, path.join(dirPath, fileName));
      }

      // The root itself is a special entry — it represents top-level modules
      // that can be imported by name but don't belong to any package.
      // We store it under "" (empty dotted path) for lookup convenience.
      const entry: PythonPackageEntry = {
        dottedPath: "",
        directoryPath: dirPath,
        kind: hasInit ? "regular" : "namespace",
        initFile: hasInit ? path.join(dirPath, "__init__.py") : null,
        modules,
      };

      packages.set("", entry);
    }

    // Recurse into subdirectories
    for (const subdir of subdirs) {
      const childDotted = dottedBase === "" ? subdir : `${dottedBase}.${subdir}`;
      await walk(path.join(dirPath, subdir), childDotted);
    }
  }

  await walk(importRoot, "");

  return {
    importRoot,
    rootConfidence,
    packages,
  };
}

// ---------------------------------------------------------------------------
// Exclusion Helpers
// ---------------------------------------------------------------------------

/**
 * Directories to skip during the package index walk.
 * These are Python-specific build/venv directories that should never
 * be indexed as packages.
 *
 * Note: this is a separate exclusion set from discoverSourceFiles()
 * in discoverFiles.ts. This set governs the *package index* walk
 * (what the resolver considers importable). The discoverFiles set
 * governs which files enter the extraction pipeline.
 */
const PACKAGE_INDEX_EXCLUDED_DIRS = new Set([
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "node_modules",
  ".git",
  "dist",
  "build",
]);

function isExcludedDir(name: string): boolean {
  return PACKAGE_INDEX_EXCLUDED_DIRS.has(name) || name.endsWith(".egg-info");
}
