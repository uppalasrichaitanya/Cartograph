/**
 * Reachability for a repository on disk: finds the manifests, reads the files
 * the entry-point rules need, gathers the signals that could hide import
 * paths, and hands both to the pure modules (entryPoints.ts, reachability.ts).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DependencyGraph, ReachabilityResult } from "@/types/graph";
import type { RawExtraction } from "./ir/types";
import { findEntryPoints } from "./entryPoints";
import { computeReachability, type ReachabilitySignals } from "./reachability";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "__pycache__", "site-packages", "dist", "build"]);
const MAX_MANIFEST_DEPTH = 6;

/** File-routed frameworks whose conventions the entry-point rules do not know. */
const UNRECOGNISED_FRAMEWORKS: ReadonlyArray<[RegExp, string]> = [
  [/^nuxt$/, "Nuxt"],
  [/^@remix-run\//, "Remix"],
  [/^@react-router\//, "React Router"],
  [/^gatsby$/, "Gatsby"],
  [/^astro$/, "Astro"],
  [/^@sveltejs\/kit$/, "SvelteKit"],
  [/^@angular\/core$/, "Angular"],
  [/^@solidjs\/start$/, "SolidStart"],
  [/^expo-router$/, "Expo Router"],
  [/^@docusaurus\/core$/, "Docusaurus"],
  [/^vitepress$/, "VitePress"],
  [/^@redwoodjs\//, "RedwoodJS"],
];

// Text scans for imports whose target is computed at run time. They can also
// match inside strings or comments, which only makes the caveat more cautious.
const DYNAMIC_JS = /\b(?:import|require)\s*\(\s*(?!(?:"[^"\n]*"|'[^'\n]*'|`[^`$\n]*`)\s*[,)])/;
const DYNAMIC_PY = /\b(?:import_module|__import__)\s*\(\s*[^\s"')]/;

async function findManifests(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isFile() && (entry.name === "package.json" || entry.name === "pyproject.toml")) {
        found.push(path.relative(projectRoot, full).split(path.sep).join("/"));
      } else if (
        entry.isDirectory() &&
        depth < MAX_MANIFEST_DEPTH &&
        !entry.name.startsWith(".") &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      ) {
        await walk(full, depth + 1);
      }
    }
  };
  await walk(projectRoot, 0);
  return found.sort();
}

export async function analyzeRepositoryReachability(input: {
  projectRoot: string;
  graph: DependencyGraph;
  extractions: ReadonlyArray<RawExtraction>;
}): Promise<ReachabilityResult> {
  const { projectRoot, graph } = input;
  const manifestPaths = await findManifests(projectRoot);
  const contents = new Map<string, string>();
  const load = async (relative: string) => {
    try {
      contents.set(relative, await readFile(path.join(projectRoot, relative), "utf8"));
    } catch {
      // Unreadable: the rules treat it as absent.
    }
  };
  await Promise.all([...manifestPaths, ...graph.nodes.map((node) => node.path)].map(load));

  const files = graph.nodes.map((node) => node.path);
  const entryPoints = findEntryPoints({ files, manifestPaths, read: (p) => contents.get(p) });

  let dynamicImportFiles = 0;
  for (const file of files) {
    const text = contents.get(file) ?? "";
    if (file.endsWith(".py") ? DYNAMIC_PY.test(text) : !file.endsWith(".go") && DYNAMIC_JS.test(text)) dynamicImportFiles++;
  }
  let unresolvedInternalImports = 0;
  for (const extraction of input.extractions) unresolvedInternalImports += extraction.unresolvedInternalImports?.length ?? 0;

  const frameworks = new Set<string>();
  for (const manifest of manifestPaths.filter((p) => p.endsWith("package.json"))) {
    try {
      const pkg = JSON.parse(contents.get(manifest) ?? "") as Record<string, Record<string, string> | undefined>;
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
        for (const [pattern, label] of UNRECOGNISED_FRAMEWORKS) if (pattern.test(name)) frameworks.add(label);
      }
    } catch {
      // A malformed manifest contributes no signal.
    }
  }

  const signals: ReachabilitySignals = {
    dynamicImportFiles,
    unresolvedInternalImports,
    unrecognisedFrameworks: [...frameworks].sort(),
  };
  return computeReachability({ graph, entryPoints, signals });
}
