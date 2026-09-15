import type { EdgeId, FileNode, NodeId, RepositoryIR, Provenance } from "../ir/types";
import type {
  ArchitectureInferenceData,
  ArchitectureInferenceGroup,
  ArchitectureInferenceOverrides,
  HeuristicGroupKind,
} from "./types";

const LAYER_WORDS = new Set([
  "api", "app", "application", "components", "config", "core", "data", "domain",
  "infrastructure", "infra", "lib", "middleware", "model", "persistence", "presentation",
  "routes", "services", "shared", "ui", "utils", "views", "web",
]);

function groupId(kind: HeuristicGroupKind, name: string): string {
  return `inferred-${kind}:${name}`;
}

function heuristicProvenance(nodeIds: ReadonlyArray<NodeId>, edgeIds: ReadonlyArray<EdgeId>): Provenance {
  return {
    origin: "heuristic",
    derivedFrom: [...nodeIds, ...edgeIds],
    note: "Inferred from repository paths and dependency structure; may be wrong",
  };
}

function userProvenance(nodeIds: ReadonlyArray<NodeId>): Provenance {
  return { origin: "user-defined", derivedFrom: [...nodeIds] };
}

function topLevel(path: string): string {
  return path.split("/")[0] ?? path;
}

function inferLayer(file: FileNode): string {
  const segments = file.path.split("/").slice(0, -1).map((segment) => segment.toLowerCase());
  const candidate = [...segments].reverse().find((segment) => LAYER_WORDS.has(segment));
  return candidate ?? topLevel(file.path);
}

function inferDomain(file: FileNode): string | null {
  const segments = file.path.split("/").slice(0, -1);
  if (segments.length < 2) return null;
  const start = segments[0]?.toLowerCase() === "src" ? 1 : 0;
  const candidate = segments[start];
  if (!candidate || LAYER_WORDS.has(candidate.toLowerCase())) return null;
  return candidate;
}

function buildGroups(
  kind: HeuristicGroupKind,
  assignments: ReadonlyMap<string, ReadonlyArray<NodeId>>,
  overrides: ReadonlySet<string>,
  importEdgeIdsByNode: ReadonlyMap<string, ReadonlyArray<EdgeId>>,
): ArchitectureInferenceGroup[] {
  return [...assignments.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ids]) => {
      const memberNodeIds = [...ids].sort((a, b) => a.localeCompare(b));
      const allUserDefined = memberNodeIds.every((id) => overrides.has(id));
      const edgeIds = memberNodeIds.flatMap((id) => importEdgeIdsByNode.get(id) ?? []);
      return {
        id: groupId(kind, name),
        kind,
        name,
        memberNodeIds,
        provenance: allUserDefined
          ? userProvenance(memberNodeIds)
          : heuristicProvenance(memberNodeIds, edgeIds),
      };
    });
}

export function inferArchitectureViews(
  ir: RepositoryIR,
  overrides: ArchitectureInferenceOverrides = {},
): ArchitectureInferenceData {
  const files = ir.nodes.filter((node): node is FileNode => node.kind === "File");
  const edgeIdsByNode = new Map<string, EdgeId[]>();
  for (const edge of ir.edges) {
    if (edge.kind !== "imports") continue;
    edgeIdsByNode.set(edge.from, [...(edgeIdsByNode.get(edge.from) ?? []), edge.id]);
  }
  const layer = new Map<string, NodeId[]>();
  const domain = new Map<string, NodeId[]>();
  const layerOverrides = new Set(Object.keys(overrides.layerByNodeId ?? {}));
  const domainOverrides = new Set(Object.keys(overrides.domainByNodeId ?? {}));
  for (const file of files) {
    const layerName = overrides.layerByNodeId?.[file.id] ?? inferLayer(file);
    layer.set(layerName, [...(layer.get(layerName) ?? []), file.id]);
    const domainName = overrides.domainByNodeId?.[file.id] ?? inferDomain(file);
    if (domainName) domain.set(domainName, [...(domain.get(domainName) ?? []), file.id]);
  }
  return {
    inferenceVersion: 1,
    groups: [
      ...buildGroups("layer", layer, layerOverrides, edgeIdsByNode),
      ...buildGroups("domain", domain, domainOverrides, edgeIdsByNode),
    ],
  };
}
