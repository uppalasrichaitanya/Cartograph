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
/** Entry points to open with. */
const MAX_ENTRY_STEPS = 2;
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

/** Order by a count, highest first, with the path breaking ties so the tour is stable. */
const byCountThenPath = (count: (path: string) => number) => (a: string, b: string) =>
  count(b) - count(a) || a.localeCompare(b);

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

  const inDegree = (path: string) => importers.get(path)?.size ?? 0;
  const outDeg = (path: string) => outDegree.get(path) ?? 0;
  const regionOf = (path: string) => nodes.get(path)!.folder;

  const steps: TourStep[] = [];
  const chosen = new Set<string>();
  const take = (id: string, reason: string) => {
    chosen.add(id);
    steps.push({ id, reason });
  };

  /* 1. Where execution begins. */
  const entries = (reachability?.entryPoints ?? []).filter(
    (entry) => nodes.has(entry.path) && !NOT_A_START.has(ruleOf(entry.reason)) && outDeg(entry.path) > 0,
  );
  if (entries.length > 0) {
    const reasonOf = new Map(entries.map((entry) => [entry.path, entry.reason]));
    const ranked = [...reasonOf.keys()].sort(byCountThenPath(outDeg));
    for (const path of ranked.slice(0, MAX_ENTRY_STEPS)) {
      take(path, `Entry point (${reasonOf.get(path)}); imports ${plural(outDeg(path), "file")}.`);
    }
  } else {
    const roots = graph.nodes
      .map((node) => node.id)
      .filter((path) => outDeg(path) > 0 && !TEST_PATH.test(path) && ![...(importers.get(path) ?? [])].some((from) => !TEST_PATH.test(from)))
      .sort(byCountThenPath(outDeg));
    if (roots[0]) take(roots[0], `Imports ${plural(outDeg(roots[0]), "file")}; no non-test file imports it.`);
  }

  /* 2. What everything leans on, spread across regions where it can be. */
  const popular = graph.nodes
    .map((node) => node.id)
    .filter((path) => !chosen.has(path) && inDegree(path) > 0 && !TEST_PATH.test(path))
    .sort(byCountThenPath(inDegree));
  const hubs: string[] = [];
  const regionsUsed = new Set(steps.map((step) => regionOf(step.id)));
  for (const path of popular) {
    if (hubs.length >= MAX_HUB_STEPS || steps.length + hubs.length >= MAX_TOUR_STEPS) break;
    if (regionsUsed.has(regionOf(path))) continue;
    regionsUsed.add(regionOf(path));
    hubs.push(path);
  }
  // A graph concentrated in few regions still gets some hubs.
  for (const path of popular) {
    if (hubs.length >= Math.min(2, MAX_HUB_STEPS)) break;
    if (!hubs.includes(path)) hubs.push(path);
  }
  hubs.sort(byCountThenPath(inDegree));
  for (const path of hubs) {
    const from = importers.get(path)!;
    const regions = new Set([...from].map(regionOf));
    take(path, `Imported by ${plural(from.size, "file")} across ${plural(regions.size, "region")}.`);
  }

  /* 3. A representative for each large region not yet visited. */
  const filesByRegion = new Map<string, string[]>();
  for (const node of graph.nodes) {
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
      .filter((path) => !chosen.has(path) && !TEST_PATH.test(path))
      .sort((a, b) => inDegree(b) - inDegree(a) || outDeg(b) - outDeg(a) || a.localeCompare(b))[0];
    if (!best) continue;
    const reason = inDegree(best) > 0
      ? `Most imported file in ${region}: imported by ${plural(inDegree(best), "file")}.`
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
