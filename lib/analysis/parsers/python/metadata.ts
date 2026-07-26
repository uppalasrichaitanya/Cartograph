/**
 * Python Project Metadata & Import-Root Detection
 *
 * Implements the deterministic import-root heuristic specified in
 * milestone-3-python-parser-plan.md §3.1. Reads `pyproject.toml` and
 * `setup.cfg` to detect declared layouts, then falls back to structural
 * heuristics when no valid declaration is found.
 *
 * This module is intentionally decoupled from the parser lifecycle — it
 * operates on a project root path and returns a result object. The
 * `PythonParser.initialize()` method (Phase 2) will call into this module.
 *
 * Design principles:
 *   - Deterministic: two runs against the same repo always produce the
 *     same result. The heuristic step ordering is itself part of the spec.
 *   - Metadata-only: reads config files as data, never executes them.
 *   - Fail-safe: parse errors in config files are treated as "no config"
 *     (fall through to structural heuristic), never crash the pipeline.
 *
 * Created as part of Milestone 3, Phase 1 (Metadata & Root Detection).
 *
 * @module lib/analysis/parsers/python/metadata
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseTOML } from "smol-toml";

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/**
 * Result of the import-root detection heuristic.
 *
 * Every field is populated — callers never need to handle partial results.
 * If no import root could be determined, the project root itself is used
 * (the safest fallback — it just means no relative-to-root offsetting).
 */
export interface ImportRootResult {
  /** Absolute path to the detected import root directory. */
  readonly importRoot: string;
  /** Which heuristic step actually produced the result. */
  readonly rootConfidence: "declared" | "structural-heuristic";
  /** From `[project.name]` in pyproject.toml, if present. */
  readonly declaredPackageName: string | null;
}

// ---------------------------------------------------------------------------
// TOML Safe Access Helpers
// ---------------------------------------------------------------------------

/**
 * Safely traverse a nested object by key path, returning undefined
 * if any segment is missing or not an object.
 */
function getNestedValue(obj: unknown, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Check if a path exists on disk and is a directory.
 */
async function isExistingDirectory(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a directory contains at least one `.py` file in its subtree.
 * Used by the structural heuristic to validate that `src/` is a real
 * Python source tree, not just an empty or non-Python directory.
 */
async function containsPythonFiles(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".py")) return true;
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const hasNested = await containsPythonFiles(path.join(dirPath, entry.name));
        if (hasNested) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 1: pyproject.toml Declared Layout
// ---------------------------------------------------------------------------

/**
 * Attempt to detect the import root from pyproject.toml.
 *
 * Checks, in fixed order, for known build-backend keys that declare
 * the source layout. Returns the first valid (exists-on-disk) path.
 *
 * Returns null if pyproject.toml doesn't exist, can't be parsed,
 * or no valid declared layout is found.
 */
async function detectFromPyprojectToml(
  projectRoot: string,
): Promise<{ importRoot: string; packageName: string | null } | null> {
  const tomlPath = path.join(projectRoot, "pyproject.toml");

  let content: string;
  try {
    content = await readFile(tomlPath, "utf8");
  } catch {
    return null; // File doesn't exist or isn't readable
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseTOML(content) as Record<string, unknown>;
  } catch {
    return null; // Invalid TOML — treat as no config
  }

  // Extract package name for later use
  const packageName = (getNestedValue(parsed, "project", "name") as string) ?? null;

  // Check 1: [tool.setuptools.packages.find] where = [...]
  const setuptoolsWhere = getNestedValue(
    parsed, "tool", "setuptools", "packages", "find", "where",
  );
  if (Array.isArray(setuptoolsWhere)) {
    for (const entry of setuptoolsWhere) {
      if (typeof entry === "string") {
        const candidate = path.resolve(projectRoot, entry);
        if (await isExistingDirectory(candidate)) {
          return { importRoot: candidate, packageName };
        }
      }
    }
  }

  // Check 2: [tool.setuptools] package-dir = {"" = "..."}
  const packageDir = getNestedValue(parsed, "tool", "setuptools", "package-dir");
  if (packageDir !== null && typeof packageDir === "object") {
    const rootMapping = (packageDir as Record<string, unknown>)[""];
    if (typeof rootMapping === "string") {
      const candidate = path.resolve(projectRoot, rootMapping);
      if (await isExistingDirectory(candidate)) {
        return { importRoot: candidate, packageName };
      }
    }
  }

  // Check 3: [tool.hatch.build.targets.wheel] packages = [...]
  const hatchPackages = getNestedValue(
    parsed, "tool", "hatch", "build", "targets", "wheel", "packages",
  );
  if (Array.isArray(hatchPackages) && hatchPackages.length > 0) {
    const firstPkg = hatchPackages[0];
    if (typeof firstPkg === "string") {
      // The parent directory of the first package is the import root
      const pkgPath = path.resolve(projectRoot, firstPkg);
      const candidate = path.dirname(pkgPath);
      if (await isExistingDirectory(candidate)) {
        return { importRoot: candidate, packageName };
      }
    }
  }

  // Check 4: [tool.poetry] packages = [{include = "...", from = "..."}]
  const poetryPackages = getNestedValue(parsed, "tool", "poetry", "packages");
  if (Array.isArray(poetryPackages) && poetryPackages.length > 0) {
    const firstEntry = poetryPackages[0];
    if (firstEntry !== null && typeof firstEntry === "object") {
      const fromDir = (firstEntry as Record<string, unknown>).from;
      if (typeof fromDir === "string") {
        const candidate = path.resolve(projectRoot, fromDir);
        if (await isExistingDirectory(candidate)) {
          return { importRoot: candidate, packageName };
        }
      }
    }
  }

  // Check 5: [tool.flit.module] name = "..."
  const flitModuleName = getNestedValue(parsed, "tool", "flit", "module", "name");
  if (typeof flitModuleName === "string") {
    // Flit's convention: flat layout, import root = project root
    return { importRoot: projectRoot, packageName };
  }

  // No valid declaration found — return null to fall through
  // Still return packageName if we found one, for use as a hint
  return null;
}

// ---------------------------------------------------------------------------
// Step 2: setup.cfg Declared Layout
// ---------------------------------------------------------------------------

/**
 * Minimal INI parser for setup.cfg.
 *
 * Only extracts the keys we care about:
 *   - [options] package_dir
 *   - [options.packages.find] where
 *
 * This is intentionally not a full-featured INI parser. We parse just
 * enough to extract our target keys reliably.
 */
function parseSetupCfgKeys(content: string): {
  packageDir: string | null;
  packagesWhere: string | null;
} {
  let currentSection = "";
  let packageDir: string | null = null;
  let packagesWhere: string | null = null;

  // First pass: resolve continuation lines.
  // In INI format, lines starting with whitespace continue the previous key's value.
  // We merge them into the previous line before parsing key-value pairs.
  const rawLines = content.split(/\r?\n/);
  const mergedLines: string[] = [];
  for (const rawLine of rawLines) {
    const isIndented = rawLine.length > 0 && (rawLine[0] === " " || rawLine[0] === "\t");
    if (isIndented && mergedLines.length > 0) {
      // Continuation: append to previous line
      mergedLines[mergedLines.length - 1] += " " + rawLine.trim();
    } else {
      mergedLines.push(rawLine);
    }
  }

  for (const rawLine of mergedLines) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;

    // Section header
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim().toLowerCase();
    const value = kvMatch[2].trim();

    if (currentSection === "options" && key === "package_dir") {
      // Value format after continuation merge: "= src" or "" = src"
      // We extract the directory path after the mapping "=" sign
      const dirMatch = value.match(/(?:""?\s*)?=\s*(.+)/);
      if (dirMatch) {
        packageDir = dirMatch[1].trim();
      } else if (value !== "") {
        // Simple case: package_dir = src
        packageDir = value;
      }
    }

    if (currentSection === "options.packages.find" && key === "where") {
      packagesWhere = value;
    }
  }

  return { packageDir, packagesWhere };
}

/**
 * Attempt to detect the import root from setup.cfg.
 *
 * Returns null if setup.cfg doesn't exist, can't be parsed,
 * or no valid declared layout is found.
 */
async function detectFromSetupCfg(
  projectRoot: string,
): Promise<string | null> {
  const cfgPath = path.join(projectRoot, "setup.cfg");

  let content: string;
  try {
    content = await readFile(cfgPath, "utf8");
  } catch {
    return null;
  }

  const { packageDir, packagesWhere } = parseSetupCfgKeys(content);

  // Try packages.find.where first (more specific)
  if (packagesWhere) {
    const candidate = path.resolve(projectRoot, packagesWhere);
    if (await isExistingDirectory(candidate)) {
      return candidate;
    }
  }

  // Then try package_dir
  if (packageDir) {
    const candidate = path.resolve(projectRoot, packageDir);
    if (await isExistingDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step 3: Structural Heuristic
// ---------------------------------------------------------------------------

/**
 * Detect import root via structural heuristic.
 *
 * Deterministic, in order:
 *   1. If `src/` exists and contains Python files → import root = `src/`
 *   2. Else → import root = project root
 *
 * Always returns a result (never null).
 */
async function detectStructural(projectRoot: string): Promise<string> {
  const srcDir = path.join(projectRoot, "src");
  if (await isExistingDirectory(srcDir) && await containsPythonFiles(srcDir)) {
    return srcDir;
  }
  return projectRoot;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the Python import root for a project.
 *
 * Applies the deterministic heuristic from §3.1 in exact order:
 *   1. pyproject.toml declared layout (highest priority)
 *   2. setup.cfg declared layout
 *   3. Structural heuristic (src/ detection, project-root fallback)
 *
 * Always returns a result — never throws, never returns null.
 *
 * @param projectRoot - Absolute path to the project root directory
 */
export async function detectImportRoot(projectRoot: string): Promise<ImportRootResult> {
  // Step 1: pyproject.toml
  const pyprojectResult = await detectFromPyprojectToml(projectRoot);
  if (pyprojectResult) {
    return {
      importRoot: pyprojectResult.importRoot,
      rootConfidence: "declared",
      declaredPackageName: pyprojectResult.packageName,
    };
  }

  // Step 2: setup.cfg
  const setupCfgRoot = await detectFromSetupCfg(projectRoot);
  if (setupCfgRoot) {
    // Try to extract package name from pyproject.toml even if layout came from setup.cfg
    let packageName: string | null = null;
    try {
      const tomlContent = await readFile(path.join(projectRoot, "pyproject.toml"), "utf8");
      const parsed = parseTOML(tomlContent) as Record<string, unknown>;
      packageName = (getNestedValue(parsed, "project", "name") as string) ?? null;
    } catch {
      // No pyproject.toml or can't parse — that's fine
    }

    return {
      importRoot: setupCfgRoot,
      rootConfidence: "declared",
      declaredPackageName: packageName,
    };
  }

  // Step 3: Structural heuristic
  const structuralRoot = await detectStructural(projectRoot);

  // Try to extract package name from pyproject.toml if available
  let packageName: string | null = null;
  try {
    const tomlContent = await readFile(path.join(projectRoot, "pyproject.toml"), "utf8");
    const parsed = parseTOML(tomlContent) as Record<string, unknown>;
    packageName = (getNestedValue(parsed, "project", "name") as string) ?? null;
  } catch {
    // No pyproject.toml or can't parse — that's fine
  }

  return {
    importRoot: structuralRoot,
    rootConfidence: "structural-heuristic",
    declaredPackageName: packageName,
  };
}

// Re-export helpers for testing
export { parseSetupCfgKeys as _parseSetupCfgKeys };
