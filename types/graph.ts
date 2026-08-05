import type { RepositoryIR } from "@/lib/analysis/ir/types";

export type SourceFileAnalysis = {
  filePath: string;
  lineCount: number;
  imports: string[];
  externalImports: string[];
};

export type GraphNode = {
  id: string;
  path: string;
  folder: string;
  lineCount: number;
  imports: string[];
  externalImports: string[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
};

export type DependencyGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Cluster = {
  name: string;
  fileIds: string[];
};

export type Anomalies = {
  cycles: string[][];
  godModules: { filePath: string; inDegree: number }[];
  orphans: string[];
};

export type ParseError = {
  filePath: string;
  message: string;
};

/**
 * How much evidence stands behind what a rendered element asserts.
 *
 * This is the render-layer projection of the IR's Provenance model
 * (lib/analysis/ir/types.ts). The five states are deliberate and each is
 * visually distinguishable:
 *
 *   verified  — directly observed in source.
 *   derived   — deterministically computed from verified/derived facts only.
 *               Equally reliable as verified; differs in that it has lineage.
 *   heuristic — best-effort; may be wrong. Reduced evidence.
 *   unknown   — a fact exists but its target could not be determined.
 *               Never rendered as absence; absence would assert "nothing here".
 *   assisted  — generated interpretation. Never graph geometry. Nothing
 *               produces this yet; the state exists so that the first AI
 *               feature cannot be retrofitted into looking like a fact.
 */
export type RenderConfidence =
  | "verified"
  | "derived"
  | "heuristic"
  | "unknown"
  | "assisted";

/**
 * The subset of RenderConfidence that may appear as graph geometry.
 *
 * `assisted` is deliberately excluded at the type level. Generated
 * interpretation must never become a node or an edge — it belongs to a
 * separate surface with its own typography and an explicit label. Enforcing
 * that here means the constraint cannot be violated by a later edit that
 * merely looks reasonable; the compiler rejects it.
 */
export type GeometryConfidence = Exclude<RenderConfidence, "assisted">;

export type RenderNodeData = {
  label: string;
  /**
   * 'folder' and 'file' are structures found in the repository.
   * 'unresolved' is a stub standing where a dependency's target could not be
   * determined — the import exists, its destination does not resolve. It is
   * rendered rather than omitted because an absent edge would be
   * indistinguishable from "imports nothing", which would be a false claim.
   */
  kind: "folder" | "file" | "unresolved";
  folder?: string;
  filePath?: string;
  fileIds?: string[];
  /**
   * Unresolved stubs only: the raw specifier exactly as written in source.
   */
  specifier?: string;
  /**
   * Unresolved stubs only: the path of the file that referenced the specifier.
   * Carried because an unresolved import's meaning is relative to where it was
   * written — the same specifier in two files denotes two unknown targets.
   */
  referencedBy?: string;
  /**
   * Evidence standing behind this node. Always present.
   *
   * Replaces the former `variant?: "warning"`, which conflated two
   * unrelated axes: it was derived from anomaly detection (god modules,
   * cycles) — observations about structure — and rendered in the visual
   * register of low confidence. Observations now live in `anomalies` and
   * are surfaced as lenses; confidence is this field alone.
   */
  confidence: GeometryConfidence;
  /**
   * Folder nodes only: how many contained files have reduced confidence.
   *
   * An aggregate over the per-file values already computed — it introduces
   * no new judgement. Lets a region communicate that it contains uncertainty
   * without the region itself claiming to be uncertain, since the grouping
   * is deterministic regardless of what it contains.
   */
  reducedConfidenceCount?: number;
  /**
   * Folder nodes only: true when this region is drawn inside another region's
   * file view, standing for a collapsed neighbour that owns the far end of a
   * cross-boundary dependency.
   *
   * Distinct from confidence. The target is fully known and verified; it is
   * simply not currently drawn. The flag exists so the interface can say
   * "this continues elsewhere" rather than implying either uncertainty or
   * that the region is a peer of the files around it.
   */
  isBoundary?: boolean;
};

export type RenderNode = {
  id: string;
  position: { x: number; y: number };
  data: RenderNodeData;
  width?: number;
  height?: number;
};

export type RenderEdge = {
  id: string;
  source: string;
  target: string;
  /**
   * Evidence standing behind this relationship.
   *
   * Optional only for backward compatibility with analyses persisted before
   * this field existed; every newly produced edge sets it. Consumers should
   * treat absence as 'derived', matching what the IR would have said.
   *
   * Replaces the former `animated?: boolean`, which was set when both
   * endpoints were anomaly-flagged and rendered as a moving dashed line —
   * motion spent on an observation, not on confidence, and drawing the eye
   * to it continuously.
   */
  confidence?: GeometryConfidence;
};

export type RenderGraph = {
  nodes: RenderNode[];
  edges: RenderEdge[];
};

export type RenderData = {
  folderView: RenderGraph;
  fileViewByFolder: Record<string, RenderGraph>;
};

export type RepoMeta = {
  repoName: string;
  language: string | null;
  framework: string | null;
  fileCount: number;
  folderCount: number;
  dependencyCount: number;
  analysisTimestamp: string;
  repoSizeBytes: number | null;
};

export type AnalysisResult = {
  id: string;
  createdAt: string;
  shareUrl: string;
  graph: DependencyGraph;
  clusters: Cluster[];
  anomalies: Anomalies;
  parseErrors: ParseError[];
  renderData: RenderData;
  repoMeta: RepoMeta;
  /**
   * The validated, versioned Intermediate Representation built alongside
   * the existing DependencyGraph. Optional for two distinct reasons:
   * analyses saved before Phase 7 do not have it, and IR construction can
   * fail (which indicates a builder bug, not bad user input — the legacy
   * pipeline continues regardless).
   *
   * Previously typed `unknown` to avoid coupling this module to the IR
   * module. That decoupling had a real cost: the IR is where provenance,
   * per-file confidence, unresolved imports, and structured parse errors
   * live, and an `unknown` at this boundary meant none of it could reach
   * the client. The coupling is deliberate — this is the type that carries
   * Cartograph's evidence model to the interface that must display it.
   */
  repositoryIR?: RepositoryIR;
};
