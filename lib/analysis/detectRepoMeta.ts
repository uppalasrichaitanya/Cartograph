import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RepoMeta } from "@/types/graph";
import type { DependencyGraph } from "@/types/graph";
import type { Cluster } from "@/types/graph";

/** Config-file → framework mapping. */
const FRAMEWORK_SIGNALS: [string | RegExp, string][] = [
  ["next.config.js", "Next.js"],
  ["next.config.ts", "Next.js"],
  ["next.config.mjs", "Next.js"],
  [/^nuxt\.config\./, "Nuxt"],
  ["vite.config.js", "Vite"],
  ["vite.config.ts", "Vite"],
  ["vite.config.mjs", "Vite"],
  ["remix.config.js", "Remix"],
  ["remix.config.ts", "Remix"],
  ["angular.json", "Angular"],
  ["svelte.config.js", "SvelteKit"],
  ["svelte.config.ts", "SvelteKit"],
  ["astro.config.mjs", "Astro"],
  ["astro.config.ts", "Astro"],
  ["gatsby-config.js", "Gatsby"],
  ["gatsby-config.ts", "Gatsby"],
];

/** Dependency name → framework mapping (checked when no config file found). */
const DEP_SIGNALS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@angular/core", "Angular"],
  ["svelte", "Svelte"],
  ["vue", "Vue"],
  ["gatsby", "Gatsby"],
  ["astro", "Astro"],
  ["@solidjs/start", "SolidStart"],
  ["solid-js", "Solid"],
  ["preact", "Preact"],
];

/**
 * Detect the primary framework from config files and package.json.
 * Returns null if nothing is detected.
 */
async function detectFramework(projectRoot: string): Promise<string | null> {
  try {
    const entries = await readdir(projectRoot);
    for (const [signal, framework] of FRAMEWORK_SIGNALS) {
      if (signal instanceof RegExp) {
        if (entries.some((name) => signal.test(name))) return framework;
      } else {
        if (entries.includes(signal)) return framework;
      }
    }

    // Fallback: scan package.json dependencies.
    const pkgPath = path.join(projectRoot, "package.json");
    const pkgText = await readFile(pkgPath, "utf8").catch(() => null);
    if (pkgText) {
      const pkg = JSON.parse(pkgText) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, framework] of DEP_SIGNALS) {
        if (dep in allDeps) return framework;
      }
    }
  } catch {
    // Fail gracefully.
  }
  return null;
}

/**
 * Detect primary language from the analyzed source files.
 * Simply counts .ts/.tsx vs .js/.jsx among analyzed nodes.
 */
function detectLanguage(graph: DependencyGraph): string | null {
  let tsCount = 0;
  let jsCount = 0;
  for (const node of graph.nodes) {
    const ext = path.extname(node.path).toLowerCase();
    if (ext === ".ts" || ext === ".tsx") tsCount++;
    else if (ext === ".js" || ext === ".jsx") jsCount++;
  }
  if (tsCount === 0 && jsCount === 0) return null;
  return tsCount >= jsCount ? "TypeScript" : "JavaScript";
}

/**
 * Build repository metadata from the analysis results.
 * Runs after clustering + graph building so all data is available.
 * This adds negligible processing time.
 */
export async function detectRepoMeta(
  projectRoot: string,
  graph: DependencyGraph,
  clusters: Cluster[],
  repoName: string,
  repoSizeBytes: number | null,
): Promise<RepoMeta> {
  const framework = await detectFramework(projectRoot);
  const language = detectLanguage(graph);

  return {
    repoName,
    language,
    framework,
    fileCount: graph.nodes.length,
    folderCount: clusters.length,
    dependencyCount: graph.edges.length,
    analysisTimestamp: new Date().toISOString(),
    repoSizeBytes,
  };
}
