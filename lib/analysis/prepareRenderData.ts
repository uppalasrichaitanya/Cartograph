import path from "node:path";
import ELK from "elkjs/lib/elk.bundled.js";
import type {
  Anomalies,
  Cluster,
  DependencyGraph,
  RenderData,
  RenderEdge,
  RenderGraph,
  RenderNode,
} from "@/types/graph";

const elk = new ELK();

type LayoutInput = {
  id: string;
  label: string;
  width: number;
  height: number;
  node: Omit<RenderNode, "position" | "width" | "height">;
};

async function layout(nodes: LayoutInput[], edges: RenderEdge[]): Promise<RenderGraph> {
  if (nodes.length === 0) return { nodes: [], edges: [] };
  try {
    const result = await elk.layout({
      id: "cartograph",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      },
      children: nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
      edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    });
    const positioned = new Map((result.children ?? []).map((node) => [node.id, node]));
    return {
      nodes: nodes.map((node, index) => {
        const positionedNode = positioned.get(node.id);
        return {
          ...node.node,
          id: node.id,
          width: node.width,
          height: node.height,
          position: positionedNode
            ? { x: positionedNode.x ?? 0, y: positionedNode.y ?? 0 }
            : { x: (index % 4) * 260, y: Math.floor(index / 4) * 140 },
        };
      }),
      edges,
    };
  } catch {
    return {
      nodes: nodes.map((node, index) => ({
        ...node.node,
        id: node.id,
        width: node.width,
        height: node.height,
        position: { x: (index % 4) * 260, y: Math.floor(index / 4) * 140 },
      })),
      edges,
    };
  }
}

function warningFiles(anomalies: Anomalies): Set<string> {
  return new Set([
    ...anomalies.godModules.map((module) => module.filePath),
    ...anomalies.cycles.flatMap((cycle) => cycle.slice(0, -1)),
  ]);
}

export async function prepareRenderData(
  graph: DependencyGraph,
  clusters: Cluster[],
  anomalies: Anomalies,
): Promise<RenderData> {
  const warnings = warningFiles(anomalies);
  const folderByFile = new Map(graph.nodes.map((node) => [node.id, node.folder]));
  const folderId = (folder: string) => `folder:${folder}`;
  const aggregateEdges = new Map<string, RenderEdge>();

  for (const edge of graph.edges) {
    const from = folderByFile.get(edge.from);
    const to = folderByFile.get(edge.to);
    if (!from || !to || from === to) continue;
    const source = folderId(from);
    const target = folderId(to);
    aggregateEdges.set(`${source}->${target}`, { id: `${source}->${target}`, source, target });
  }

  const folderView = await layout(
    clusters.map((cluster) => {
      const files = cluster.fileIds;
      const warningCount = files.filter((file) => warnings.has(file)).length;
      return {
        id: folderId(cluster.name),
        label: cluster.name,
        width: 220,
        height: 82,
        node: {
          id: folderId(cluster.name),
          data: {
            label: cluster.name,
            kind: "folder",
            folder: cluster.name,
            fileIds: files,
            warningCount,
            ...(warningCount > 0 ? { variant: "warning" as const } : {}),
          },
        },
      };
    }),
    [...aggregateEdges.values()],
  );

  const fileViewByFolder: Record<string, RenderGraph> = {};
  for (const cluster of clusters) {
    const contained = new Set(cluster.fileIds);
    const nodes = graph.nodes.filter((node) => contained.has(node.id));
    const edges = graph.edges
      .filter((edge) => contained.has(edge.from) && contained.has(edge.to))
      .map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, animated: warnings.has(edge.from) && warnings.has(edge.to) }));
    fileViewByFolder[cluster.name] = await layout(
      nodes.map((node) => ({
        id: node.id,
        label: node.path,
        width: 230,
        height: 66,
        node: {
          id: node.id,
          data: {
            label: path.posix.basename(node.path),
            kind: "file",
            folder: cluster.name,
            filePath: node.path,
            ...(warnings.has(node.id) ? { variant: "warning" as const } : {}),
          },
        },
      })),
      edges,
    );
  }

  return { folderView, fileViewByFolder };
}
