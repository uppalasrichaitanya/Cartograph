import path from "node:path";
import type { Cluster, DependencyGraph } from "@/types/graph";

export function proposedFolder(filePath: string): string {
  const segments = path.posix.dirname(filePath).split("/").filter((segment) => segment !== ".");
  if (segments.length === 0) return "root";
  // `src/components` and `src/services` are far more useful boundaries than one giant `src` cluster.
  if (segments[0] === "src" && segments[1]) return `src/${segments[1]}`;
  return segments[0];
}

export function computeFolderClusters(
  filePaths: ReadonlyArray<string>,
): Cluster[] {
  const proposed = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const folder = proposedFolder(filePath);
    proposed.set(folder, [...(proposed.get(folder) ?? []), filePath]);
  }

  const clusters = new Map<string, string[]>();
  for (const [folder, fileIds] of proposed) {
    const clusterName = fileIds.length < 3 ? "other" : folder;
    clusters.set(clusterName, [...(clusters.get(clusterName) ?? []), ...fileIds]);
  }

  return [...clusters.entries()]
    .map(([name, fileIds]) => ({ name, fileIds: fileIds.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function applyFolderClusters(
  graph: DependencyGraph,
  clusters: ReadonlyArray<Cluster>,
): Cluster[] {
  const folderByFile = new Map<string, string>();
  for (const cluster of clusters) {
    for (const fileId of cluster.fileIds) folderByFile.set(fileId, cluster.name);
  }
  for (const node of graph.nodes) node.folder = folderByFile.get(node.id) ?? "other";
  return clusters.map((cluster) => ({
    name: cluster.name,
    fileIds: [...cluster.fileIds],
  }));
}

export function clusterByFolder(graph: DependencyGraph): Cluster[] {
  return applyFolderClusters(
    graph,
    computeFolderClusters(graph.nodes.map((node) => node.path)),
  );
}
