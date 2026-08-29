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
