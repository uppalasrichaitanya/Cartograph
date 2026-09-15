import type { AnalysisResult } from "@/types/graph";
import { createGraphQuery, type GraphQuery, type QueryNode } from "./index";

/** Create the sanctioned read view for a persisted analysis result. */
export function queryAnalysis(
  result: Pick<AnalysisResult, "graph" | "repositoryIR">,
): GraphQuery<QueryNode> {
  return result.repositoryIR
    ? createGraphQuery(result.repositoryIR)
    : createGraphQuery(result.graph);
}
