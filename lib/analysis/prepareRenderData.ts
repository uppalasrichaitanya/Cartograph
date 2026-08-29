import path from "node:path";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  collectUnresolvedImports,
  edgeConfidenceFromSource,
  projectConfidenceByPath,
} from "./projectConfidence";
import type { RepositoryIR } from "./ir/types";
import { clustersFromArchitectureModel } from "./architecture-model/model";
import type { ArchitectureModelData } from "./architecture-model/types";
import { nodeBoxHeight, nodeBoxWidth } from "@/lib/workspace/nodeMetrics";
import type {
  Cluster,
  DependencyGraph,
  GeometryConfidence,
  ParseError,
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

/**
 * Prepare the pre-laid-out render graphs for the client.
 *
 * Layout is computed here, server-side and deterministically, so the same
 * repository always produces the same map — for the same person returning
 * later, and for anyone they share it with.
 *
 * Confidence is stamped here too, projected from the IR. It is deliberately
 * NOT derived from `anomalies`: cycles and dependency hubs are observations
 * about structure, not statements about how well that structure is known.
 * Conflating them (as the former `variant: "warning"` did) rendered
 * well-understood code in the visual register of doubt.
 *
 * @param ir - Validated IR, or null if construction failed. Confidence
 *   falls back to the legacy parseErrors list in that case; see
 *   projectConfidence.ts for why that beats rendering everything as unknown.
 */
export async function prepareRenderData(
  graph: DependencyGraph,
  clusters: Cluster[],
  ir: RepositoryIR | null | undefined,
  parseErrors: ReadonlyArray<ParseError>,
  architectureModel?: ArchitectureModelData | null,
): Promise<RenderData> {
  const displayClusters = architectureModel
    ? clustersFromArchitectureModel(architectureModel, graph, ir ?? undefined)
    : clusters;
  const confidenceByPath = projectConfidenceByPath(
    ir,
    graph.nodes.map((node) => node.path),
    parseErrors,
  );
  // Legacy graph node ids are file paths; RenderData is keyed the same way.
  const confidenceOf = (fileId: string): GeometryConfidence =>
    confidenceByPath.get(fileId) ?? "verified";
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
    displayClusters.map((cluster) => {
      const files = cluster.fileIds;
      // Aggregate only — how many contained files have reduced confidence.
      // The folder's own confidence stays 'derived': the grouping is a
      // deterministic computation over verified facts regardless of how
      // well any individual file inside it is understood.
      const reducedConfidenceCount = files.filter(
        (file) => confidenceOf(file) !== "verified",
      ).length;
      return {
        id: folderId(cluster.name),
        label: cluster.name,
        width: nodeBoxWidth("folder"),
        height: nodeBoxHeight({
          kind: "folder",
          confidence: "derived",
          hasReducedConfidenceCount: reducedConfidenceCount > 0,
        }),
        node: {
          id: folderId(cluster.name),
          data: {
            label: cluster.name,
            kind: "folder" as const,
            folder: cluster.name,
            fileIds: files,
            confidence: "derived" as const,
            ...(reducedConfidenceCount > 0 ? { reducedConfidenceCount } : {}),
          },
        },
      };
    }),
    [...aggregateEdges.values()],
  );

  const fileViewByFolder: Record<string, RenderGraph> = {};
  const unresolvedByFile = collectUnresolvedImports(ir);

  for (const cluster of displayClusters) {
    const contained = new Set(cluster.fileIds);
    const nodes = graph.nodes.filter((node) => contained.has(node.id));
    const edges: RenderEdge[] = graph.edges
      .filter((edge) => contained.has(edge.from) && contained.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        confidence: edgeConfidenceFromSource(confidenceOf(edge.from)),
      }));

    // Cross-boundary dependencies.
    //
    // These used to be discarded outright: the filter above requires BOTH
    // endpoints inside the cluster, so every dependency crossing a region
    // boundary vanished on drill-in. A file importing seven modules from
    // elsewhere rendered with no outgoing edges at all — while the inspector
    // listed all seven as navigable links. The map and the inspector
    // contradicted each other about identical evidence, and the map was the
    // one telling the falsehood.
    //
    // They now terminate at a stub standing for the collapsed neighbouring
    // region that owns the target. The dependency stays visible; only its far
    // end is collapsed. Clicking the stub navigates into that region, so the
    // relationship remains followable rather than merely acknowledged.
    //
    // A boundary stub is NOT an unresolved import. The target here is fully
    // known and verified — it is simply not currently drawn. So these edges
    // keep the confidence they would have anyway (propagated from the source
    // file) and keep their arrowhead: something definite is on the other end.
    const boundaryStubIds = new Map<string, string>();
    const boundaryEdges = new Map<string, RenderEdge>();

    for (const edge of graph.edges) {
      const fromInside = contained.has(edge.from);
      const toInside = contained.has(edge.to);
      // Both inside → already handled. Both outside → irrelevant to this view.
      if (fromInside === toInside) continue;

      const outsideFileId = fromInside ? edge.to : edge.from;
      const neighbour = folderByFile.get(outsideFileId);
      if (!neighbour || neighbour === cluster.name) continue;

      const stubId = folderId(neighbour);
      boundaryStubIds.set(neighbour, stubId);

      const insideFileId = fromInside ? edge.from : edge.to;
      const source = fromInside ? insideFileId : stubId;
      const target = fromInside ? stubId : insideFileId;
      const key = `${source}->${target}`;
      if (boundaryEdges.has(key)) continue;

      // Confidence follows the source file's extracted facts, exactly as for
      // an intra-region edge. Collapsing the target changes how much is drawn,
      // never how well the relationship is known.
      boundaryEdges.set(key, {
        id: key,
        source,
        target,
        confidence: edgeConfidenceFromSource(confidenceOf(edge.from)),
      });
    }

    const layoutInputs: LayoutInput[] = nodes.map((node) => {
      const confidence = confidenceOf(node.id);
      return {
        id: node.id,
        label: node.path,
        width: nodeBoxWidth("file"),
        height: nodeBoxHeight({ kind: "file", confidence }),
        node: {
          id: node.id,
          data: {
            label: path.posix.basename(node.path),
            kind: "file" as const,
            folder: cluster.name,
            filePath: node.path,
            confidence,
          },
        },
      };
    });

    // Unresolved imports become visible stubs.
    //
    // One stub per (file, specifier), matching how the IR models them: the
    // same specifier written in two files denotes two different unknown
    // targets, and merging them would assert an identity we cannot support.
    //
    // Rendering these at all is the point. Omitting an unresolved import
    // would leave a file looking as though it imports nothing, which is a
    // false statement about the source — the import is right there in the
    // code; only its destination is unknown.
    for (const node of nodes) {
      const unresolved = unresolvedByFile.get(node.path) ?? [];
      for (const ref of unresolved) {
        const stubId = `unresolved:${node.id}:${ref.specifier}`;
        layoutInputs.push({
          id: stubId,
          label: ref.specifier,
          width: nodeBoxWidth("unresolved"),
          height: nodeBoxHeight({ kind: "unresolved", confidence: "unknown" }),
          node: {
            id: stubId,
            data: {
              label: ref.specifier,
              kind: "unresolved" as const,
              folder: cluster.name,
              specifier: ref.specifier,
              referencedBy: node.path,
              confidence: "unknown" as const,
            },
          },
        });
        edges.push({
          id: `${node.id}->${stubId}`,
          source: node.id,
          target: stubId,
          confidence: "unknown" as const,
        });
      }
    }

    // Boundary stubs standing for collapsed neighbouring regions.
    //
    // Confidence is 'derived', matching how the same region is described in
    // the folder overview: containment is a deterministic computation over
    // verified facts. A collapsed region is not an uncertain one.
    for (const [neighbour, stubId] of boundaryStubIds) {
      const neighbourCluster = displayClusters.find((c) => c.name === neighbour);
      layoutInputs.push({
        id: stubId,
        label: neighbour,
        width: nodeBoxWidth("folder"),
        // A boundary stub draws the same rows as the region it stands for,
        // minus the aggregate: it reports its own size and that it is
        // collapsed, not the confidence of files it is not showing.
        height: nodeBoxHeight({ kind: "folder", confidence: "derived" }),
        node: {
          id: stubId,
          data: {
            label: neighbour,
            kind: "folder" as const,
            folder: neighbour,
            fileIds: neighbourCluster?.fileIds ?? [],
            confidence: "derived" as const,
            isBoundary: true,
          },
        },
      });
    }
    edges.push(...boundaryEdges.values());

    fileViewByFolder[cluster.name] = await layout(layoutInputs, edges);
  }

  return { folderView, fileViewByFolder };
}
