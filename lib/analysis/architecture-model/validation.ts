import type { FileNode, RepositoryIR } from "../ir/types";
import { validateProvenance } from "../ir/validation";
import type {
  ArchitectureModelData,
  BoundaryId,
  BoundaryKind,
  BoundaryRecord,
} from "./types";

const KINDS: readonly BoundaryKind[] = ["module-root", "folder", "region"];

export class ArchitectureModelValidationError extends Error {
  constructor(public readonly path: string, detail: string) {
    super(`Architecture Model validation failed at '${path}': ${detail}`);
    this.name = "ArchitectureModelValidationError";
  }
}

function compareBoundaries(a: BoundaryRecord, b: BoundaryRecord): number {
  return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || a.path.localeCompare(b.path)
    || a.id.localeCompare(b.id);
}

export function validateArchitectureModel(
  model: ArchitectureModelData,
  ir: RepositoryIR,
): ArchitectureModelData {
  if (model.modelVersion !== 1) {
    throw new ArchitectureModelValidationError("modelVersion", "expected 1");
  }
  const fileIds = new Set(
    ir.nodes.filter((node): node is FileNode => node.kind === "File").map((node) => node.id),
  );
  const filePathById = new Map(
    ir.nodes
      .filter((node): node is FileNode => node.kind === "File")
      .map((node) => [node.id, node.path]),
  );
  const ids = new Set<BoundaryId>();
  let previousBoundary: BoundaryRecord | undefined;

  for (const [index, boundary] of model.boundaries.entries()) {
    const base = `boundaries[${index}]`;
    if (!KINDS.includes(boundary.kind)) {
      throw new ArchitectureModelValidationError(`${base}.kind`, `unknown kind '${boundary.kind}'`);
    }
    if (!boundary.name.trim()) {
      throw new ArchitectureModelValidationError(`${base}.name`, "must be non-empty");
    }
    if (ids.has(boundary.id)) {
      throw new ArchitectureModelValidationError(`${base}.id`, `duplicate id '${boundary.id}'`);
    }
    ids.add(boundary.id);
    if (previousBoundary && compareBoundaries(previousBoundary, boundary) > 0) {
      throw new ArchitectureModelValidationError(base, "boundaries must be deterministically ordered");
    }
    previousBoundary = boundary;
    const contained = new Set<string>();
    let previousFilePath = "";
    for (const [nodeIndex, nodeId] of boundary.containedNodeIds.entries()) {
      if (!fileIds.has(nodeId)) {
        throw new ArchitectureModelValidationError(
          `${base}.containedNodeIds[${nodeIndex}]`,
          `unknown file node '${nodeId}'`,
        );
      }
      if (contained.has(nodeId)) {
        throw new ArchitectureModelValidationError(
          `${base}.containedNodeIds[${nodeIndex}]`,
          `duplicate file node '${nodeId}'`,
        );
      }
      contained.add(nodeId);
      const filePath = filePathById.get(nodeId) ?? "";
      if (previousFilePath && filePath.localeCompare(previousFilePath) < 0) {
        throw new ArchitectureModelValidationError(
          `${base}.containedNodeIds[${nodeIndex}]`,
          "contained nodes must be ordered by file path",
        );
      }
      previousFilePath = filePath;
    }
    validateProvenance(boundary.provenance, `${base}.provenance`);
  }

  for (const [index, boundary] of model.boundaries.entries()) {
    if (boundary.parentId && !ids.has(boundary.parentId)) {
      throw new ArchitectureModelValidationError(
        `boundaries[${index}].parentId`,
        `unknown boundary '${boundary.parentId}'`,
      );
    }
    const visited = new Set<string>([boundary.id]);
    let parentId = boundary.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        throw new ArchitectureModelValidationError(
          `boundaries[${index}].parentId`,
          "boundary parent cycle detected",
        );
      }
      visited.add(parentId);
      parentId = model.boundaries.find((candidate) => candidate.id === parentId)?.parentId;
    }
  }
  return model;
}
