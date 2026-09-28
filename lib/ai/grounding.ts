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
  if (!citation.id) return false;
  const ids =
    citation.kind === "node" ? evidence.nodeIds
    : citation.kind === "edge" ? evidence.edgeIds
    : citation.kind === "region" ? evidence.regionIds
    : citation.kind === "analyzer-result" ? evidence.analyzerResultIds
    : undefined;
  return ids?.has(citation.id) ?? false;
}

// A standalone figure: not part of an identifier such as `v2`, `gpt-4o` or a path.
const NUMBER_PATTERN = /(?<![\w./-])\d{1,3}(?:,\d{3})+(?![\w/-])|(?<![\w./-])\d+(?:\.\d+)?(?![\w/-])/g;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER_PATTERN) ?? []).map((value) => value.replace(/,/g, ""));
}

/**
 * Every figure present in an evidence object: numeric values, list lengths,
 * and standalone numbers inside strings.
 */
export function evidenceNumbers(evidence: unknown): ReadonlySet<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "number") found.add(String(value));
    else if (typeof value === "string") for (const number of numbersIn(value)) found.add(number);
    else if (Array.isArray(value)) { found.add(String(value.length)); value.forEach(visit); }
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(evidence);
  return found;
}

/**
 * Citations prove a claim points at real evidence, not that its wording is
 * right. The most common wrong wording is an invented figure, which can be
 * caught mechanically: claims stating numbers absent from the evidence are
 * dropped.
 */
export function dropUnsupportedFigures(
  response: AiResponse,
  supported: ReadonlySet<string>,
): { response: AiResponse; dropped: number } {
  const claims = response.claims.filter((claim) => numbersIn(claim.text).every((number) => supported.has(number)));
  const answerSupported = numbersIn(response.answer).every((number) => supported.has(number));
  return {
    response: { ...response, claims, answer: answerSupported ? response.answer : "" },
    dropped: response.claims.length - claims.length + (answerSupported ? 0 : 1),
  };
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
