/**
 * Measured structural findings: the figure's doubts and discrepancies,
 * computed without AI. Rules are added in Task 5.
 *
 * @module lib/diagram/checks
 */
import type { DependencyGraph } from "@/types/graph";
import type { DiagramEdge, DiagramFinding, DiagramUnit } from "./types";

export type ChecksInput = Readonly<{
  graph: DependencyGraph;
  units: ReadonlyArray<DiagramUnit>;
  /** Every aggregated edge, before the edge budget. */
  edges: ReadonlyArray<DiagramEdge>;
  unitOfFile: ReadonlyMap<string, string>;
  unresolved: ReadonlyMap<string, number>;
  oversizedUnitIds: ReadonlyArray<string>;
  scopeKind: "repository" | "region";
  isTest: (path: string) => boolean;
}>;

export function runDiagramChecks(_input: ChecksInput): DiagramFinding[] {
  return [];
}
