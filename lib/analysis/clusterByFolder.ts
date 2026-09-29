import path from "node:path";
import type { Cluster, DependencyGraph } from "@/types/graph";
import { buildFolderTree, findFolder, type FolderTreeNode } from "./folderTree";

export function proposedFolder(filePath: string): string {
  const segments = path.posix.dirname(filePath).split("/").filter((segment) => segment !== ".");
  if (segments.length === 0) return "root";
  // `src/components` and `src/services` are far more useful boundaries than one giant `src` cluster.
  if (segments[0] === "src" && segments[1]) return `src/${segments[1]}`;
  return segments[0];
}

/**
 * A region is split along its own sub-folders once it holds more than
 * `maxRegionFiles` files, and only into sub-folders of at least
 * `minRegionFiles` (the same threshold that sends tiny folders to "other").
 */
export const REGION_LIMITS = { maxRegionFiles: 30, minRegionFiles: 3, maxSplitDepth: 3 } as const;

export type RegionStrategy = "legacy" | "adaptive";

function splitRegion(tree: FolderTreeNode, name: string, fileIds: string[], depth: number): Cluster[] {
  const whole = [{ name, fileIds }];
  if (fileIds.length <= REGION_LIMITS.maxRegionFiles || depth >= REGION_LIMITS.maxSplitDepth) return whole;
  const folder = findFolder(tree, name);
  if (!folder) return whole;
  const members = new Set(fileIds);
  const qualifying = folder.children
    .map((child) => ({ child, files: child.allFiles.filter((file) => members.has(file)) }))
    .filter(({ files }) => files.length >= REGION_LIMITS.minRegionFiles);
  if (qualifying.length < 2) return whole;
  const taken = new Set(qualifying.flatMap(({ files }) => files));
  const rest = fileIds.filter((file) => !taken.has(file));
  return [
    ...qualifying.flatMap(({ child, files }) => splitRegion(tree, child.path, files, depth + 1)),
    ...(rest.length > 0 ? [{ name, fileIds: rest }] : []),
  ];
}

export function computeFolderClusters(
  filePaths: ReadonlyArray<string>,
  strategy: RegionStrategy = "adaptive",
): Cluster[] {
  const proposed = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const folder = proposedFolder(filePath);
    proposed.set(folder, [...(proposed.get(folder) ?? []), filePath]);
  }

  const tree = strategy === "adaptive" ? buildFolderTree(filePaths) : null;
  const clusters = new Map<string, string[]>();
  for (const [folder, fileIds] of proposed) {
    if (fileIds.length < REGION_LIMITS.minRegionFiles) {
      clusters.set("other", [...(clusters.get("other") ?? []), ...fileIds]);
      continue;
    }
    const parts = tree ? splitRegion(tree, folder, fileIds, 0) : [{ name: folder, fileIds }];
    for (const part of parts) clusters.set(part.name, [...(clusters.get(part.name) ?? []), ...part.fileIds]);
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
