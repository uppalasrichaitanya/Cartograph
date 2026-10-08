import { readFileSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/**
 * Describes a discovered source file in the project.
 *
 * Previously defined in resolveAliases.ts. Moved here as part of
 * the Milestone 2 migration to decouple file discovery from the
 * legacy resolution module.
 *
 * Structurally compatible with ParseFileInput (absolutePath + relative path),
 * but uses `filePath` for the relative path to maintain backward compatibility
 * with the existing pipeline consumers.
 */
export type ProjectFile = {
  absolutePath: string;
  filePath: string;
};

/**
 * Default source extensions for root signal detection.
 * Used by findProjectRoot() to detect whether a directory looks like
 * a project root. Also used as the fallback for discoverSourceFiles()
 * when no registry-provided set is given.
 */
const DEFAULT_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py", ".go"]);
/**
 * Directories skipped by name alone: names that only ever mean tooling output
 * or vendored dependencies. Names that are also ordinary source folder names
 * (env, venv, build, dist) are NOT here; see isPythonVirtualenv and
 * isBuildOutputDirectory.
 */
const EXCLUDED_DIRECTORIES = new Set([
  // JavaScript / TypeScript
  "node_modules", ".git", ".next",
  // Python — virtual environments (dot-named ones are also caught by the dot rule)
  ".venv",
  // Python — caches and tool artifacts
  "__pycache__", ".pytest_cache", ".tox", ".mypy_cache", ".ruff_cache",
  // Python — build artifacts
  "site-packages",
  // Conda
  "conda-meta",
]);

/**
 * Directory-name suffix patterns for exclusion.
 * These catch names like `mypackage.egg-info` that vary by project name.
 */
const EXCLUDED_DIRECTORY_SUFFIXES = [".egg-info"];
export const MAX_SOURCE_FILES = 800;

/** Files whose presence makes a directory a package/project root. */
const PACKAGE_ROOT_MARKERS = new Set(["package.json", "tsconfig.json", "pyproject.toml", "setup.py", "go.mod"]);
/** Conventional build-output directory names, honoured only beside a package root. */
const BUILD_OUTPUT_NAMES = new Set(["dist", "build"]);

type DirectoryEntries = Dirent<string>[];

/**
 * Is this directory a Python virtualenv? Decided by content, never by name:
 * a pyvenv.cfg file, or an activate script together with a site-packages
 * folder. A source package that happens to be called "env" has neither.
 */
async function isPythonVirtualenv(directory: string, entries: DirectoryEntries): Promise<boolean> {
  const names = new Set(entries.map((entry) => entry.name));
  if (entries.some((entry) => entry.name === "pyvenv.cfg" && entry.isFile())) return true;
  const scriptsDirectory = ["bin", "Scripts"].find((name) => names.has(name));
  if (!scriptsDirectory) return false;
  try {
    const scripts = await readdir(path.join(directory, scriptsDirectory));
    if (!scripts.some((name) => name === "activate" || name === "activate.bat")) return false;
    if (names.has("Lib") && (await readdir(path.join(directory, "Lib"))).includes("site-packages")) return true;
    if (names.has("lib")) {
      for (const child of await readdir(path.join(directory, "lib"))) {
        if (child === "site-packages") return true;
        if (child.startsWith("python") && (await readdir(path.join(directory, "lib", child))).includes("site-packages")) return true;
      }
    }
  } catch {
    // unreadable: treat as not a virtualenv
  }
  return false;
}

/** The tsconfig outDir declared directly in this directory, resolved, if any. */
function configuredOutDirectory(directory: string): string | null {
  try {
    const configPath = path.join(directory, "tsconfig.json");
    const config = ts.readConfigFile(configPath, (file) => readFileSync(file, "utf8"));
    const outDir = config.config?.compilerOptions?.outDir;
    return typeof outDir === "string" ? path.resolve(directory, outDir) : null;
  } catch {
    return null;
  }
}

export class DiscoveryError extends Error {}

export async function findProjectRoot(extractionDirectory: string): Promise<string> {
  const entries = await readdir(extractionDirectory, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => !entry.name.startsWith(".") && entry.name !== "__MACOSX");
  const rootSignals = visibleEntries.some(
    (entry) =>
      entry.name === "package.json" ||
      entry.name === "tsconfig.json" ||
      entry.name === "jsconfig.json" ||
      entry.name === "pyproject.toml" ||
      entry.name === "setup.cfg" ||
      entry.name === "go.mod" ||
      DEFAULT_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
  );
  const directories = visibleEntries.filter((entry) => entry.isDirectory());
  if (!rootSignals && directories.length === 1) return path.join(extractionDirectory, directories[0].name);
  return extractionDirectory;
}

/**
 * Discover source files in the project directory.
 *
 * Walks the directory tree (excluding node_modules, .git, etc.) and
 * collects files with supported extensions.
 *
 * @param projectRoot - Absolute path to the project root directory
 * @param supportedExtensions - Optional set of file extensions (without dots)
 *   to discover. When provided (e.g., from ParserRegistry.getRegisteredExtensions()),
 *   only files with these extensions are discovered. When omitted, falls back
 *   to the default set (.ts, .tsx, .js, .jsx).
 */
export async function discoverSourceFiles(
  projectRoot: string,
  supportedExtensions?: ReadonlySet<string>,
): Promise<ProjectFile[]> {
  // Normalize extensions to include leading dots for path.extname() comparison.
  // Registry extensions come without dots (e.g., "ts"); the default set uses dots.
  const extensions: ReadonlySet<string> = supportedExtensions
    ? new Set([...supportedExtensions].map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)))
    : DEFAULT_SOURCE_EXTENSIONS;

  const discovered: ProjectFile[] = [];
  // tsconfig outDirs seen so far; a parent is always walked before its children.
  const outDirectories = new Set<string>();
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    // dist/ and build/ are build output only beside a package root (the
    // project root counts as one) or where tsconfig's outDir says so.
    const isPackageRoot =
      directory === projectRoot || entries.some((entry) => entry.isFile() && PACKAGE_ROOT_MARKERS.has(entry.name));
    const outDirectory = configuredOutDirectory(directory);
    if (outDirectory && outDirectory !== path.resolve(directory)) outDirectories.add(outDirectory);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          EXCLUDED_DIRECTORIES.has(entry.name) ||
          EXCLUDED_DIRECTORY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)) ||
          (isPackageRoot && BUILD_OUTPUT_NAMES.has(entry.name)) ||
          outDirectories.has(path.resolve(fullPath)) ||
          (await isPythonVirtualenv(fullPath, await readdir(fullPath, { withFileTypes: true })))
        ) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      discovered.push({
        absolutePath: fullPath,
        filePath: path.relative(projectRoot, fullPath).split(path.sep).join("/"),
      });
      if (discovered.length > MAX_SOURCE_FILES) {
        throw new DiscoveryError("Repository has more than 800 source files. Try a smaller project or subfolder.");
      }
    }
  };

  await walk(projectRoot);
  if (discovered.length === 0) {
    const extList = [...extensions].map((e) => e.startsWith(".") ? e : `.${e}`).sort().join(", ");
    throw new DiscoveryError(`No source files (${extList}) were found in this archive.`);
  }
  return discovered.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
