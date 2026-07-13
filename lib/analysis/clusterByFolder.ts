import path from "node:path";
import type { Cluster, DependencyGraph } from "@/types/graph";

function proposedFolder(filePath: string): string {
  const segments = path.posix.dirname(filePath).split("/").filter((segment) => segment !== ".");
  if (segments.length === 0) return "root";
  // `src/components` and `src/services` are far more useful boundaries than one giant `src` cluster.
  if (segments[0] === "src" && segments[1]) return `src/${segments[1]}`;
  return segments[0];
}

export function clusterByFolder(graph: DependencyGraph): Cluster[] {
  const proposed = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const folder = proposedFolder(node.path);
    proposed.set(folder, [...(proposed.get(folder) ?? []), node.id]);
  }

  const clusters = new Map<string, string[]>();
  for (const [folder, fileIds] of proposed) {
    const clusterName = fileIds.length < 3 ? "other" : folder;
    clusters.set(clusterName, [...(clusters.get(clusterName) ?? []), ...fileIds]);
    for (const id of fileIds) {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      if (node) node.folder = clusterName;
    }
  }

  return [...clusters.entries()]
    .map(([name, fileIds]) => ({ name, fileIds: fileIds.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
