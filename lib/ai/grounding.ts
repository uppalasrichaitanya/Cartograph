import type { AnalysisResult } from "@/types/graph";
import { queryAnalysis } from "@/lib/analysis/query/analysisResult";
import type { AiEvidenceCatalog, AiQueryContext, AiResponse, Citation } from "./types";

export function evidenceCatalog(result: Pick<AnalysisResult, "graph" | "repositoryIR" | "analysisViews">): AiEvidenceCatalog {
  const nodes = result.repositoryIR?.nodes ?? result.graph.nodes;
  const edges = result.repositoryIR?.edges ?? result.graph.edges;
  return {
    nodeIds: new Set(nodes.map((node) => node.id)),
    edgeIds: new Set(edges.map((edge) => edge.id)),
    analyzerResultIds: new Set((result.analysisViews ?? []).map((view) => view.analyzerId)),
  };
}

export function createAiQueryContext(result: Pick<AnalysisResult, "graph" | "repositoryIR" | "analysisViews">): AiQueryContext {
  return { query: queryAnalysis(result), evidence: evidenceCatalog(result) };
}

export function validateCitation(citation: Citation, evidence: AiEvidenceCatalog): boolean {
  if (!citation.id || !evidence[`${citation.kind === "node" ? "node" : citation.kind === "edge" ? "edge" : "analyzerResult"}Ids` as keyof AiEvidenceCatalog]) return false;
  const ids = citation.kind === "node" ? evidence.nodeIds : citation.kind === "edge" ? evidence.edgeIds : evidence.analyzerResultIds;
  return ids.has(citation.id);
}

export function validateGrounding(response: AiResponse, evidence: AiEvidenceCatalog): ReadonlyArray<string> {
  const errors: string[] = [];
  for (const [index, claim] of response.claims.entries()) {
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
