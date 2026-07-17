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

export type RenderNodeData = {
  label: string;
  kind: "folder" | "file";
  folder?: string;
  filePath?: string;
  fileIds?: string[];
  variant?: "warning";
  warningCount?: number;
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
  animated?: boolean;
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
   * the existing DependencyGraph. Optional for backward compatibility —
   * analyses saved before Phase 7 will not have this field.
   *
   * Typed as `unknown` here to avoid coupling the legacy types module to
   * the IR module. The actual shape is RepositoryIR (lib/analysis/ir/types.ts)
   * and is validated by the IR Builder's finalize() before assignment.
   */
  repositoryIR?: unknown;
};
