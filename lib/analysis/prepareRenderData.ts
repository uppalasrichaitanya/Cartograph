import path from "node:path";
import ELK, { type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
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

type Pt = { x: number; y: number };

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Lay the nodes out with ELK.
 *
 * With `routed`, every edge end gets a port of its own: `<edge>::s` on the
 * source's east side and `<edge>::t` on the target's west side, spread along
 * the side by ELK (a lone port stays centred). ELK's orthogonal routes come
 * back on the edges as `route`, with `anchor` giving each end's vertical offset
 * from its node's middle, so arrows into one box arrive separately. The client
 * draws the route (see lib/workspace/routedPath.ts) instead of guessing a path
 * between handles. Region arrows are deliberately not routed: they are few, weighted
 * beziers.
 */
async function layout(
  nodes: LayoutInput[],
  edges: RenderEdge[],
  routed = false,
): Promise<RenderGraph> {
  if (nodes.length === 0) return { nodes: [], edges: [] };
  try {
    // A self-loop has no meaningful route to draw; keep it out of the router.
    const routable = routed ? edges.filter((edge) => edge.source !== edge.target) : edges;
    const result = await elk.layout({
      id: "cartograph",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        ...(routed
          ? {
              "elk.edgeRouting": "ORTHOGONAL",
              "elk.spacing.edgeNode": "18",
              "elk.spacing.edgeEdge": "12",
              "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
              "elk.layered.spacing.edgeNodeBetweenLayers": "20",
              "elk.spacing.portPort": "10",
              "elk.portAlignment.default": "CENTER",
            }
          : {}),
      },
      children: nodes.map((node) => ({
        id: node.id,
        width: node.width,
        height: node.height,
        ...(routed
          ? {
              layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
              ports: [
                ...routable
                  .filter((edge) => edge.source === node.id)
                  .map((edge) => ({ id: `${edge.id}::s`, width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } })),
                ...routable
                  .filter((edge) => edge.target === node.id)
                  .map((edge) => ({ id: `${edge.id}::t`, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } })),
              ],
            }
          : {}),
      })),
      edges: routable.map((edge) => ({
        id: edge.id,
        sources: [routed ? `${edge.id}::s` : edge.source],
        targets: [routed ? `${edge.id}::t` : edge.target],
      })),
    });
    const positioned = new Map((result.children ?? []).map((node) => [node.id, node]));
    const routes = new Map<string, Pt[]>();
    if (routed) {
      for (const elkEdge of (result.edges ?? []) as ElkExtendedEdge[]) {
        const section = elkEdge.sections?.[0];
        if (!section) continue;
        // The graph is flat, so the container is the root; honour a nested
        // container's offset anyway in case that ever changes.
        const container = (elkEdge as { container?: string }).container;
        const holder = container ? positioned.get(container) : undefined;
        const [dx, dy] = [holder?.x ?? 0, holder?.y ?? 0];
        routes.set(
          elkEdge.id,
          [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
            x: round1(p.x + dx),
            y: round1(p.y + dy),
          })),
        );
      }
    }
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
      edges: routed
        ? edges.map((edge) => {
            const route = routes.get(edge.id);
            if (!route) return edge;
            const centre = (id: string) => {
              const node = positioned.get(id);
              return (node?.y ?? 0) + (node?.height ?? 0) / 2;
            };
            return {
              ...edge,
              route,
              anchor: {
                source: round1(route[0].y - centre(edge.source)) || 0,
                target: round1(route[route.length - 1].y - centre(edge.target)) || 0,
              },
            };
          })
        : edges,
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

    fileViewByFolder[cluster.name] = await layout(layoutInputs, edges, true);
  }

  return { folderView, fileViewByFolder };
}
