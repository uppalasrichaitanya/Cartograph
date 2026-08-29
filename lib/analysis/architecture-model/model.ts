import path from "node:path";
import { applyFolderClusters, computeFolderClusters } from "../clusterByFolder";
import type {
  Edge,
  FileNode,
  ModuleRoot,
  NodeId,
  Provenance,
  RepositoryIR,
} from "../ir/types";
import { createBoundaryId } from "./identity";
import { deriveProvenance } from "./provenance";
import type {
  ArchitectureModelData,
  ArchitectureModelQuery,
  BoundaryId,
  BoundaryKind,
  BoundaryRecord,
} from "./types";
import { validateArchitectureModel } from "./validation";
import type { Cluster, DependencyGraph } from "@/types/graph";

function rootProvenance(root: ModuleRoot): Provenance {
  return root.confidence === "declared"
    ? { origin: "derived", derivedFrom: [root.id] }
    : {
        origin: "heuristic",
        derivedFrom: [root.id],
        note: "Module root was inferred from repository structure",
      };
}

function directoryPrefixes(filePath: string): string[] {
  const directory = path.posix.dirname(filePath);
  if (directory === ".") return [];
  const segments = directory.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function sortedNodeIds(files: ReadonlyArray<FileNode>): NodeId[] {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => file.id);
}

function provenanceForFiles(
  files: ReadonlyArray<FileNode>,
  root: ModuleRoot | undefined,
): Provenance {
  const inputs = files.map((file) => file.provenance);
  if (root) inputs.push(rootProvenance(root));
  return deriveProvenance(inputs, [
    ...(root ? [root.id] : []),
    ...files.map((file) => file.id),
  ]);
}

export function buildArchitectureModel(ir: RepositoryIR): ArchitectureModelData {
  const files = ir.nodes.filter((node): node is FileNode => node.kind === "File");
  const filesById = new Map(files.map((file) => [file.id, file]));
  const rootsById = new Map(ir.roots.map((root) => [root.id, root]));
  const containmentEdges = ir.edges.filter(
    (edge): edge is Edge => edge.kind === "contains",
  );
  const boundaries: BoundaryRecord[] = [];

  for (const root of [...ir.roots].sort((a, b) => a.rootPath.localeCompare(b.rootPath))) {
    const rootEdges = containmentEdges.filter((edge) => edge.from === root.id);
    const ownedFiles = rootEdges
      .map((edge) => filesById.get(edge.to))
      .filter((file): file is FileNode => file !== undefined);
    const rootPath = root.rootPath || ".";
    boundaries.push({
      id: createBoundaryId("module-root", `${root.id}:${rootPath}`),
      kind: "module-root",
      name: rootPath,
      path: rootPath,
      containedNodeIds: sortedNodeIds(ownedFiles),
      provenance: deriveProvenance(
        [rootProvenance(root), ...rootEdges.map((edge) => edge.provenance)],
        [root.id, ...rootEdges.map((edge) => edge.id)],
      ),
    });
  }

  const folderPaths = new Set(files.flatMap((file) => directoryPrefixes(file.path)));
  for (const folderPath of [...folderPaths].sort()) {
    const containedFiles = files.filter(
      (file) => file.path.startsWith(`${folderPath}/`),
    );
    const root = rootsById.get(containedFiles[0]?.ownerRootId);
    const parentPath = path.posix.dirname(folderPath);
    const parentId = parentPath === "."
      ? root && createBoundaryId("module-root", `${root.id}:${root.rootPath || "."}`)
      : createBoundaryId("folder", parentPath);
    boundaries.push({
      id: createBoundaryId("folder", folderPath),
      kind: "folder",
      name: path.posix.basename(folderPath),
      path: folderPath,
      ...(parentId ? { parentId } : {}),
      containedNodeIds: sortedNodeIds(containedFiles),
      provenance: provenanceForFiles(containedFiles, root),
    });
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const cluster of computeFolderClusters(files.map((file) => file.path))) {
    const containedFiles = cluster.fileIds
      .map((filePath) => filesByPath.get(filePath))
      .filter((file): file is FileNode => file !== undefined);
    const root = rootsById.get(containedFiles[0]?.ownerRootId);
    boundaries.push({
      id: createBoundaryId("region", cluster.name),
      kind: "region",
      name: cluster.name,
      path: cluster.name,
      ...(root
        ? { parentId: createBoundaryId("module-root", `${root.id}:${root.rootPath || "."}`) }
        : {}),
      containedNodeIds: sortedNodeIds(containedFiles),
      provenance: provenanceForFiles(containedFiles, root),
    });
  }

  boundaries.sort((a, b) => {
    const order: Record<BoundaryKind, number> = {
      "module-root": 0,
      folder: 1,
      region: 2,
    };
    return order[a.kind] - order[b.kind]
      || a.path.localeCompare(b.path)
      || a.id.localeCompare(b.id);
  });
  return validateArchitectureModel({ modelVersion: 1, boundaries }, ir);
}

export class ArchitectureModel implements ArchitectureModelQuery {
  private readonly byId: Map<string, BoundaryRecord>;
  private readonly byNodeId = new Map<string, BoundaryRecord[]>();

  constructor(public readonly data: ArchitectureModelData) {
    this.byId = new Map(data.boundaries.map((boundary) => [boundary.id, boundary]));
    for (const boundary of data.boundaries) {
      for (const nodeId of boundary.containedNodeIds) {
        this.byNodeId.set(nodeId, [...(this.byNodeId.get(nodeId) ?? []), boundary]);
      }
    }
  }

  getBoundary(id: BoundaryId | string): BoundaryRecord | undefined {
    return this.byId.get(id);
  }

  getContainingBoundaries(nodeId: NodeId | string): ReadonlyArray<BoundaryRecord> {
    return this.byNodeId.get(nodeId) ?? [];
  }

  getBoundariesByKind(kind: BoundaryKind): ReadonlyArray<BoundaryRecord> {
    return this.data.boundaries.filter((boundary) => boundary.kind === kind);
  }
}

export function clustersFromArchitectureModel(
  data: ArchitectureModelData,
  graph: DependencyGraph,
  ir?: RepositoryIR,
): Cluster[] {
  const pathByCanonicalId = ir
    ? new Map(
        ir.nodes
          .filter((node): node is FileNode => node.kind === "File")
          .map((file) => [file.id, file.path]),
      )
    : null;
  const graphPaths = new Set(graph.nodes.map((node) => node.path));
  const clusters = data.boundaries
    .filter((boundary) => boundary.kind === "region")
    .map((boundary) => ({
      name: boundary.name,
      fileIds: boundary.containedNodeIds
        .map((id) => pathByCanonicalId?.get(id) ?? String(id))
        .filter((filePath) => graphPaths.has(filePath))
        .sort(),
    }))
    .filter((cluster) => cluster.fileIds.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Model records use canonical IDs. The IR supplies the compatibility adapter
  // to the path-based graph while that legacy surface remains public.
  return clusters.length > 0
    ? applyFolderClusters(graph, clusters)
    : applyFolderClusters(graph, computeFolderClusters(graph.nodes.map((node) => node.path)));
}
