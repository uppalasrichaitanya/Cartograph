import type { GraphQuery, QueryNode } from "@/lib/analysis/query";

export type CitationKind = "node" | "edge" | "region" | "analyzer-result";

export type Citation = Readonly<{
  kind: CitationKind;
  id: string;
}>;

export type GroundedClaim = Readonly<{
  text: string;
  citations: ReadonlyArray<Citation>;
  /** Which part of the explanation this claim belongs to, e.g. "Role". */
  section?: string;
}>;

/** A file the reader should open, with the reason to open it. */
export type ReadingStep = Readonly<{
  id: string;
  reason: string;
}>;

export type AiResponse = Readonly<{
  answer: string;
  claims: ReadonlyArray<GroundedClaim>;
  uncertainty?: string;
  readingOrder?: ReadonlyArray<ReadingStep>;
}>;

export type AiEvidenceCatalog = Readonly<{
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  analyzerResultIds: ReadonlySet<string>;
  /** Region (folder cluster) names. Absent means region citations are not allowed. */
  regionIds?: ReadonlySet<string>;
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
