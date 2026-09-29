import { buildGraph } from "@/lib/analysis/buildGraph";
import { clusterByFolder } from "@/lib/analysis/clusterByFolder";
import type { AnalysisResult } from "@/types/graph";

export const FIXTURE_ID = "00000000-0000-4000-8000-000000000000";

/** Build an analysis from `{ path: [imported paths] }`. Every file is 10 lines. */
export function makeResult(
  spec: Readonly<Record<string, ReadonlyArray<string>>>,
  externals: Readonly<Record<string, ReadonlyArray<string>>> = {},
  language = "TypeScript",
): AnalysisResult {
  const graph = buildGraph(Object.entries(spec).map(([filePath, imports]) => ({
    filePath, lineCount: 10, imports: [...imports], externalImports: [...(externals[filePath] ?? [])],
  })));
  const clusters = clusterByFolder(graph);
  return {
    id: FIXTURE_ID,
    createdAt: "2026-09-29T00:00:00.000Z",
    shareUrl: `/repo/${FIXTURE_ID}`,
    graph,
    clusters,
    anomalies: { cycles: [], godModules: [], orphans: [] },
    parseErrors: [],
    renderData: { folderView: { nodes: [], edges: [] }, fileViewByFolder: {} },
    repoMeta: {
      repoName: "fixture", language, framework: null, fileCount: graph.nodes.length,
      folderCount: clusters.length, dependencyCount: graph.edges.length,
      analysisTimestamp: "2026-09-29T00:00:00.000Z", repoSizeBytes: null,
    },
  };
}

/** `n` files in `folder`, each importing `imports`. */
export function many(folder: string, n: number, imports: ReadonlyArray<string> = []): Record<string, ReadonlyArray<string>> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`${folder}/f${String(i).padStart(2, "0")}.ts`, imports]));
}

/**
 * Two units that import each other through files that also have internal
 * imports, so the only finding is the cycle (no file looks misplaced).
 */
export function loop(): AnalysisResult {
  return makeResult({
    "a/x.ts": ["b/x.ts", "a/y.ts"], "a/y.ts": [], "a/z.ts": [],
    "b/x.ts": ["a/x.ts", "b/y.ts"], "b/y.ts": [], "b/z.ts": [],
  });
}

/** A web-app shaped repository used by several suites. */
export function webApp(): AnalysisResult {
  return makeResult({
    "app/page.tsx": ["components/Map.tsx", "lib/ai/explain.ts"],
    "app/api/route.ts": ["lib/analysis/core/run.ts", "lib/storage/store.ts"],
    "components/Map.tsx": ["lib/analysis/core/run.ts"],
    "components/Panel.tsx": ["components/Map.tsx"],
    "components/Search.tsx": [],
    ...many("lib/analysis/core", 12, ["lib/analysis/parsers/f00.ts"]),
    "lib/analysis/core/run.ts": ["lib/analysis/parsers/f00.ts"],
    ...many("lib/analysis/parsers", 8),
    "lib/ai/explain.ts": ["lib/analysis/core/run.ts"],
    ...many("lib/ai", 4),
    "lib/storage/store.ts": [],
    ...many("lib/storage", 4),
    "tests/a.test.ts": ["lib/ai/explain.ts"],
    "tests/b.test.ts": [],
    "tests/c.test.ts": [],
    "next.config.ts": [],
  });
}
