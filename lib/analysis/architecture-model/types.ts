import type { NodeId, Provenance } from "../ir/types";

export type BoundaryId = string & { readonly __brand: "BoundaryId" };
export type BoundaryKind = "module-root" | "folder" | "region";

export interface BoundaryRecord {
  readonly id: BoundaryId;
  readonly kind: BoundaryKind;
  readonly name: string;
  readonly path: string;
  readonly parentId?: BoundaryId;
  readonly containedNodeIds: ReadonlyArray<NodeId>;
  readonly provenance: Provenance;
}

export interface ArchitectureModelData {
  readonly modelVersion: 1;
  readonly boundaries: ReadonlyArray<BoundaryRecord>;
}

export interface ArchitectureModelQuery {
  getBoundary(id: BoundaryId | string): BoundaryRecord | undefined;
  getContainingBoundaries(nodeId: NodeId | string): ReadonlyArray<BoundaryRecord>;
  getBoundariesByKind(kind: BoundaryKind): ReadonlyArray<BoundaryRecord>;
}

/** A best-effort grouping inferred from paths and dependency structure. */
export type HeuristicGroupKind = "layer" | "domain";

export interface ArchitectureInferenceGroup {
  readonly id: string;
  readonly kind: HeuristicGroupKind;
  readonly name: string;
  readonly memberNodeIds: ReadonlyArray<NodeId>;
  readonly provenance: Provenance;
}

/** Explicit user assignments take precedence over heuristic assignments. */
export interface ArchitectureInferenceOverrides {
  readonly layerByNodeId?: Readonly<Record<string, string>>;
  readonly domainByNodeId?: Readonly<Record<string, string>>;
}

export interface ArchitectureInferenceData {
  readonly inferenceVersion: 1;
  readonly groups: ReadonlyArray<ArchitectureInferenceGroup>;
}
