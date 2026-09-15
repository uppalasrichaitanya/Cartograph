import type { AnalysisResult } from "@/types/graph";
import { createGraphQuery } from "@/lib/analysis/query";
import type { AiEvidenceCatalog, AiQueryContext, AiResponse, Citation } from "./types";

export function evidenceCatalog(result: Pick<AnalysisResult, "graph" | "repositoryIR" | "analysisViews">): AiEvidenceCatalog {
  // The workspace addresses files by their graph path IDs. Keep that identity
  // in the AI query as well, while cataloguing IR IDs when they exist so
  // citations from either persisted representation remain valid.
  const nodes = [...result.graph.nodes, ...(result.repositoryIR?.nodes ?? [])];
  const edges = [...result.graph.edges, ...(result.repositoryIR?.edges ?? [])];
  return {
    nodeIds: new Set(nodes.map((node) => node.id)),
    edgeIds: new Set(edges.map((edge) => edge.id).filter((id): id is string => Boolean(id))),
    analyzerResultIds: new Set((result.analysisViews ?? []).map((view) => view.analyzerId)),
  };
}

export function createAiQueryContext(result: Pick<AnalysisResult, "graph" | "repositoryIR" | "analysisViews">): AiQueryContext {
  return { query: createGraphQuery(result.graph), evidence: evidenceCatalog(result) };
}

export function validateCitation(citation: Citation, evidence: AiEvidenceCatalog): boolean {
  if (!citation.id || !evidence[`${citation.kind === "node" ? "node" : citation.kind === "edge" ? "edge" : "analyzerResult"}Ids` as keyof AiEvidenceCatalog]) return false;
  const ids = citation.kind === "node" ? evidence.nodeIds : citation.kind === "edge" ? evidence.edgeIds : evidence.analyzerResultIds;
  return ids.has(citation.id);
}

export function validateGrounding(response: AiResponse, evidence: AiEvidenceCatalog): ReadonlyArray<string> {
  const errors: string[] = [];
  if (!response.answer.trim()) errors.push("answer must be non-empty");
  if (response.claims.length === 0) errors.push("response must contain at least one grounded claim");
  for (const [index, claim] of response.claims.entries()) {
    if (!claim.text.trim()) errors.push(`claim ${index} has no text`);
    if (claim.citations.length === 0) errors.push(`claim ${index} has no citations`);
    for (const citation of claim.citations) {
      if (!validateCitation(citation, evidence)) errors.push(`claim ${index} cites unknown ${citation.kind} '${citation.id}'`);
    }
  }
  if (response.claims.length > 0 && response.uncertainty === "") errors.push("uncertainty must be omitted or non-empty");
  return errors;
}

export function assertGrounded(response: AiResponse, evidence: AiEvidenceCatalog): void {
  const errors = validateGrounding(response, evidence);
  if (errors.length) throw new Error(`Ungrounded AI response: ${errors.join("; ")}`);
}
