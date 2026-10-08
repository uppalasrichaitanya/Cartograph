/**
 * The guided tour: where the steps come from, and how a measured one is built.
 *
 * Cartograph states only what it measured, so a tour says which of two sources
 * it came from. Steps taken from an AI overview's `readingOrder` are labelled
 * as AI guidance; steps built here from the import graph are labelled as
 * measured. The measured builder is a pure function of the dependency graph
 * and, when the analysis has one, the reachability result.
 *
 * @module lib/workspace/tour
 */
import { ruleOf } from "@/lib/analysis/reachabilityLenses";
import type { DependencyGraph, GraphNode, ReachabilityResult } from "@/types/graph";

export type TourSource = "ai" | "measured";

export type TourStep = {
  /** File id (its path). */
  readonly id: string;
  /** Why this file is on the tour, worded as what was measured or cited. */
  readonly reason: string;
};

export const MAX_TOUR_STEPS = 7;
/** An AI tour is the model's own list; bounded so a long one stays a tour. */
const MAX_AI_STEPS = 10;
/** Most-imported files before region representatives fill the rest. */
const MAX_HUB_STEPS = 4;
/** A region needs this many files to earn a representative of its own. */
const LARGE_REGION_FILES = 3;

export function tourSourceLabel(source: TourSource): string {
  return source === "ai" ? "Guided by AI, with cited files" : "Measured from the import graph";
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Entry points that are not a sensible place to start reading. */
const NOT_A_START = new Set(["test file", "config file", "Storybook story", "example or demo", "benchmark"]);
const TEST_PATH = /(?:\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:__tests__|__mocks__|tests?|e2e)\/|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$)/;
/** Material that supports a repository without being part of it: never a hub or a region's representative. */
const SUPPORT_PATH = /(?:^|\/)(?:examples?|demos?|benchmarks?|docs?|website|scripts?|sandbox|fixtures?|playground|stories)\//;
const CONFIG_PATH = /(?:^|\/)[^/]*\.config\.[cm]?[jt]sx?$|(?:^|\/)\.[^/]*rc\.[cm]?[jt]s$/;
/** Files that only declare shapes or constants teach nothing about behaviour. */
const DECLARATION_FILE = /(?:^|\/)(?:types?|interfaces?|constants?)\.[jt]sx?$|\.d\.ts$/;

const isNoise = (path: string) => TEST_PATH.test(path) || SUPPORT_PATH.test(path) || CONFIG_PATH.test(path);

/** Order by a count, highest first, with the path breaking ties so the tour is stable. */
const byCountThenPath = (count: (path: string) => number) => (a: string, b: string) =>
  count(b) - count(a) || a.localeCompare(b);

/**
 * How primary an entry point is for someone reading the repository, and which
 * kind of entry it is (a tour takes at most one per kind).
 *
 *   0  what the package or app itself starts from: package.json main, module
 *      and bin, the conventional root file, the root layout and page
 *   1  other pages and layouts
 *   2  anything else recognised
 *   3  API routes
 *   4  exports subpaths and the browser map: surfaces, not starting points
 *   5  the docs site
 *   6  scripts
 */
function entryTier(path: string, reason: string): { tier: number; kind: string } {
  const rule = ruleOf(reason);
  if (/(?:^|\/)(?:website|docs?)\//.test(path)) return { tier: 5, kind: "docs" };
  if (rule === "script") return { tier: 6, kind: "script" };
  if (/^package\.json "(?:exports|browser)/.test(rule)) return { tier: 4, kind: rule };
  if (rule === "Next.js route") {
    if (/(?:^|\/)route\.[jt]sx?$/.test(path)) return { tier: 3, kind: "api" };
    const page = path.match(/(?:^|\/)(layout|page)\.[jt]sx?$/);
    if (page && /^(?:src\/)?app\/(?:layout|page)\./.test(path)) return { tier: page[1] === "layout" ? 0 : 0.5, kind: page[1] };
    return { tier: 1, kind: page?.[1] ?? "route" };
  }
  if (/^package\.json "bin"/.test(rule)) return { tier: 0.2, kind: rule };
  if (/^package\.json "(?:main|module)"/.test(rule) || rule === "conventional root file") {
    return { tier: 0, kind: rule.startsWith("package.json") ? rule : "root" };
  }
  return { tier: 2, kind: rule };
}

/**
 * Up to seven steps through the import graph:
 *   1. one or two entry points with the most outgoing imports, with their reason;
 *   2. the most-imported files, preferring different regions;
 *   3. a representative per remaining large region.
 *
 * Without recognised entry points (an old analysis, or none found) step 1
 * falls back to the file with the most imports that nothing imports, which is
 * said in those words rather than called an entry point.
 */
export function buildMeasuredTour(
  graph: DependencyGraph,
  reachability: ReachabilityResult | undefined,
): TourStep[] {
  const nodes = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));
  const importers = new Map<string, Set<string>>();
  const outDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    let set = importers.get(edge.to);
    if (!set) importers.set(edge.to, (set = new Set()));
    set.add(edge.from);
  }
  for (const [, set] of importers) for (const from of set) outDegree.set(from, (outDegree.get(from) ?? 0) + 1);

  const outDeg = (path: string) => outDegree.get(path) ?? 0;
  const regionOf = (path: string) => nodes.get(path)!.folder;

  const steps: TourStep[] = [];
  const chosen = new Set<string>();
  const take = (id: string, reason: string) => {
    chosen.add(id);
    steps.push({ id, reason });
  };

  /* 1. Where execution begins. */
  const entries = (reachability?.entryPoints ?? [])
    .filter((entry) => nodes.has(entry.path) && !NOT_A_START.has(ruleOf(entry.reason)) && outDeg(entry.path) > 0)
    .map((entry) => ({ ...entry, ...entryTier(entry.path, entry.reason) }))
    .sort((a, b) =>
      a.tier - b.tier ||
      a.path.split("/").length - b.path.split("/").length ||
      outDeg(b.path) - outDeg(a.path) ||
      a.path.localeCompare(b.path));
  if (entries.length > 0) {
    // The best entry opens the tour. A second one joins only if it is also a
    // primary start (tier below 2) of a different kind, so exports subpaths,
    // API routes and the like never take a step from the repository's own code.
    const picked = [entries[0]];
    const next = entries.slice(1).find((entry) => entry.tier < 2 && !picked.some((p) => p.tier === entry.tier && p.kind === entry.kind));
    if (next && entries[0].tier < 2) picked.push(next);
    for (const entry of picked) {
      take(entry.path, `Entry point: ${entry.reason}. Imports ${plural(outDeg(entry.path), "file")}.`);
    }
  } else {
    const roots = graph.nodes
      .map((node) => node.id)
      .filter((path) => outDeg(path) > 0 && !isNoise(path) && ![...(importers.get(path) ?? [])].some((from) => !TEST_PATH.test(from)))
      .sort(byCountThenPath(outDeg));
    if (roots[0]) take(roots[0], `Imports ${plural(outDeg(roots[0]), "file")}; no non-test file imports it.`);
  }

  /* 2. What everything leans on, spread across regions where it can be.
   * Importers that are tests or examples do not count towards "most imported",
   * and neither those files nor type-only ones stand in for the code itself.
   * The single most-imported file may still be a declarations file: if the
   * whole repository leans on it, it is worth a step. */
  const sourceImporters = (path: string) => [...(importers.get(path) ?? [])].filter((from) => !isNoise(from));
  const sourceIn = (path: string) => sourceImporters(path).length;
  const declarationOnly = (path: string) => DECLARATION_FILE.test(path) || outDeg(path) === 0;
  const ranked = graph.nodes
    .map((node) => node.id)
    .filter((path) => !chosen.has(path) && !isNoise(path) && sourceIn(path) > 0)
    .sort((a, b) => sourceIn(b) - sourceIn(a) || outDeg(b) - outDeg(a) || a.localeCompare(b));
  const popular = ranked.filter((path) => !declarationOnly(path) || path === ranked[0]);
  const hubs: string[] = [];
  const regionsUsed = new Set(steps.map((step) => regionOf(step.id)));
  for (const path of popular) {
    if (hubs.length >= MAX_HUB_STEPS || steps.length + hubs.length >= MAX_TOUR_STEPS) break;
    if (regionsUsed.has(regionOf(path))) continue;
    regionsUsed.add(regionOf(path));
    hubs.push(path);
  }
  // A repository concentrated in few regions still gets its most-imported files.
  for (const path of popular) {
    if (hubs.length >= MAX_HUB_STEPS || steps.length + hubs.length >= MAX_TOUR_STEPS) break;
    if (!hubs.includes(path)) hubs.push(path);
  }
  hubs.sort((a, b) => sourceIn(b) - sourceIn(a) || outDeg(b) - outDeg(a) || a.localeCompare(b));
  for (const path of hubs) {
    const from = sourceImporters(path);
    const regions = new Set(from.map(regionOf));
    take(path, `Imported by ${plural(from.length, "source file")} across ${plural(regions.size, "region")}.`);
  }

  /* 3. A representative for each large region not yet visited. */
  const filesByRegion = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (isNoise(node.id)) continue;
    const list = filesByRegion.get(node.folder);
    if (list) list.push(node.id);
    else filesByRegion.set(node.folder, [node.id]);
  }
  const visited = new Set(steps.map((step) => regionOf(step.id)));
  const regions = [...filesByRegion.entries()]
    .filter(([region, files]) => !visited.has(region) && files.length >= LARGE_REGION_FILES)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [region, files] of regions) {
    if (steps.length >= MAX_TOUR_STEPS) break;
    const best = files
      .filter((path) => !chosen.has(path) && !declarationOnly(path) && sourceIn(path) + outDeg(path) > 0)
      .sort((a, b) => sourceIn(b) - sourceIn(a) || outDeg(b) - outDeg(a) || a.localeCompare(b))[0];
    if (!best) continue;
    const reason = sourceIn(best) > 0
      ? `Most imported file in ${region}: imported by ${plural(sourceIn(best), "source file")}.`
      : `Most connected file in ${region}: imports ${plural(outDeg(best), "file")}.`;
    take(best, reason);
  }

  /* A repository too small to fill the tour above still gets its files, so
   * "tiny" means a short tour rather than an empty one. */
  if (steps.length === 0 && graph.nodes.length > 0) {
    const first = [...graph.nodes].map((n) => n.id).sort()[0];
    take(first, `Largest part of a ${plural(graph.nodes.length, "file")} repository.`);
  }
  return steps.slice(0, MAX_TOUR_STEPS);
}

/**
 * Steps from an AI overview's reading order. Unknown files are dropped (the
 * server already strips most), repeats collapse to their first mention, and
 * fewer than two usable steps is not a tour.
 */
export function aiTourSteps(
  readingOrder: ReadonlyArray<{ id: string; reason: string }> | undefined,
  knownFiles: ReadonlySet<string>,
): TourStep[] | null {
  if (!readingOrder) return null;
  const seen = new Set<string>();
  const steps: TourStep[] = [];
  for (const entry of readingOrder) {
    if (!knownFiles.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    steps.push({ id: entry.id, reason: entry.reason });
    if (steps.length >= MAX_AI_STEPS) break;
  }
  return steps.length >= 2 ? steps : null;
}
