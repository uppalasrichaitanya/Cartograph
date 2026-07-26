import { readdir } from "node:fs/promises";
import path from "node:path";

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
const DEFAULT_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
const EXCLUDED_DIRECTORIES = new Set([
  // JavaScript / TypeScript
  "node_modules", ".git", "dist", "build", ".next",
  // Python — virtual environments
  ".venv", "venv", "env",
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
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          EXCLUDED_DIRECTORIES.has(entry.name) ||
          EXCLUDED_DIRECTORY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
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
