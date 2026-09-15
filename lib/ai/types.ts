import type { GraphQuery, QueryNode } from "@/lib/analysis/query";

export type CitationKind = "node" | "edge" | "analyzer-result";

export type Citation = Readonly<{
  kind: CitationKind;
  id: string;
}>;

export type GroundedClaim = Readonly<{
  text: string;
  citations: ReadonlyArray<Citation>;
}>;

export type AiResponse = Readonly<{
  answer: string;
  claims: ReadonlyArray<GroundedClaim>;
  uncertainty?: string;
}>;

export type AiEvidenceCatalog = Readonly<{
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  analyzerResultIds: ReadonlySet<string>;
}>;

export type AiQueryContext = Readonly<{
  query: GraphQuery<QueryNode>;
  evidence: AiEvidenceCatalog;
}>;

export type AiToolResult<T> = Readonly<{
  value: T;
  claims: ReadonlyArray<GroundedClaim>;
  uncertain: boolean;
  uncertainty?: string;
}>;
