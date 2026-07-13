import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ProjectFile } from "./resolveAliases";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next"]);
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
      SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
  );
  const directories = visibleEntries.filter((entry) => entry.isDirectory());
  if (!rootSignals && directories.length === 1) return path.join(extractionDirectory, directories[0].name);
  return extractionDirectory;
}

export async function discoverSourceFiles(projectRoot: string): Promise<ProjectFile[]> {
  const discovered: ProjectFile[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
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
    throw new DiscoveryError("No .ts, .tsx, .js, or .jsx files were found in this archive.");
  }
  return discovered.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
