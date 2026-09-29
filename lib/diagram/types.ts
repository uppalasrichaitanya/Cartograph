/**
 * Shared types for presentation diagrams. Client-safe: no runtime imports.
 *
 * A diagram is built from UNITS (boxes that carry arrows) and GROUPS
 * (titled containers around units). Arrows never end on a group border;
 * that is what keeps nested figures readable.
 *
 * @module lib/diagram/types
 */
export type DiagramScope = Readonly<{ kind: "repository" }> | Readonly<{ kind: "region"; id: string }>;
export type DiagramPreset = "document" | "slide";
export type DiagramDetail = "overview" | "standard";
export type DiagramThemeName = "light" | "dark" | "print";
export type DiagramAnnotations = "none" | "measured" | "measured+ai";
export type DiagramFormat = "svg" | "mermaid";

export type DiagramOptions = Readonly<{
  scope: DiagramScope;
  preset: DiagramPreset;
  detail: DiagramDetail;
  theme: DiagramThemeName;
  background: "solid" | "transparent";
  includeTests: boolean;
  showExternal: boolean;
  annotations: DiagramAnnotations;
}>;

export type DiagramGroup = Readonly<{
  id: string;             // "g:" + folder path
  path: string;
  label: string;
  parentId: string | null;
  files: number;
}>;

export type DiagramUnitKind = "folder" | "loose-files" | "file" | "overflow" | "unresolved" | "boundary";

export type DiagramUnit = Readonly<{
  id: string;
  kind: DiagramUnitKind;
  label: string;
  path: string;
  groupId: string | null;
  files: number;
  lines: number;
  testFiles: number;
  reducedConfidence: number;
  internalImports: number;
  inCycle: boolean;
  /** Shared units only: how many distinct other units import this one. Arrows into it are not drawn. */
  sharedBy?: number;
  /** Boundary units only: "in" = the neighbour imports this region, "out" = this region imports it. */
  side?: "in" | "out";
}>;

export type DiagramEdge = Readonly<{
  id: string;             // "e:" + from + "->" + to
  from: string;
  to: string;
  count: number;
  sampleEdgeIds: ReadonlyArray<string>;
  /** In a strongly connected component (drives the "cycle" finding; not drawn as such). */
  inCycle: boolean;
  /** The reverse edge (to to from) also exists: the one cycle signal drawn on the figure. */
  mutual: boolean;
}>;

export type FindingKind = "cycle" | "test-leak" | "hub" | "isolated" | "misplaced" | "unresolved-heavy" | "oversized";

export type DiagramFinding = Readonly<{
  id: string;
  kind: FindingKind;
  confidence: "derived" | "heuristic";
  subjects: ReadonlyArray<string>;
  figures: Readonly<Record<string, number>>;
  text: string;
}>;

export type DiagramModel = Readonly<{
  scope: DiagramScope;
  title: string;
  subtitle: string;
  analysisId: string;
  analyzedAt: string;
  groups: ReadonlyArray<DiagramGroup>;
  units: ReadonlyArray<DiagramUnit>;
  edges: ReadonlyArray<DiagramEdge>;
  omitted: Readonly<{ edges: number; edgeMaxCount: number; sharedEdges: number; testFiles: number; files: number }>;
  externalPackages: ReadonlyArray<Readonly<{ name: string; importingFiles: number }>>;
  findings: ReadonlyArray<DiagramFinding>;
  /** True when the analysis has no IR, so confidence and unresolved imports are unknown. */
  partialEvidence: boolean;
}>;

export type Point = Readonly<{ x: number; y: number }>;
export type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

export type PositionedEdge = Readonly<{
  edge: DiagramEdge;
  points: ReadonlyArray<Point>;
  curved: boolean;
  label: Box | null;
}>;

export type PositionedDiagram = Readonly<{
  model: DiagramModel;
  width: number;
  height: number;
  units: ReadonlyMap<string, Box>;
  groups: ReadonlyMap<string, Box>;
  edges: ReadonlyArray<PositionedEdge>;
  simplified: boolean;
  reserveCaption: boolean;
}>;

export type DiagramNote = Readonly<{ text: string; subjects: ReadonlyArray<string>; source: "measured" | "ai" }>;

export type DiagramReviewAnnotations = Readonly<{
  captions: ReadonlyMap<string, string>;
  notes: ReadonlyArray<DiagramNote>;
}>;
