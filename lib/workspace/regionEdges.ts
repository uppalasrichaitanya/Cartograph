/**
 * How much each region-to-region arrow carries.
 *
 * Computed from the persisted file graph rather than stored render data, so
 * analyses saved before weights existed get them too.
 *
 * @module lib/workspace/regionEdges
 */
import type { DependencyGraph } from "@/types/graph";

export function regionEdgeCounts(graph: DependencyGraph): ReadonlyMap<string, number> {
  const folderOf = new Map(graph.nodes.map((node) => [node.id, node.folder]));
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    const from = folderOf.get(edge.from);
    const to = folderOf.get(edge.to);
    if (!from || !to || from === to) continue;
    const id = `folder:${from}->folder:${to}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function edgeStrokeWidth(count: number): number {
  return Math.min(4.5, Math.max(1.25, 1.25 + 0.75 * Math.log2(Math.max(1, count))));
}

export function regionSizeShare(files: number, maxFiles: number): number {
  return maxFiles > 0 ? Math.min(1, Math.max(0, files / maxFiles)) : 0;
}
