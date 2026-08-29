import { buildGraph } from "../buildGraph";
import { clusterByFolder } from "../clusterByFolder";
import { detectAnomalies } from "../detectAnomalies";
import { clustersFromArchitectureModel } from "../architecture-model/model";
import { AnalyzerRegistry } from "./registry";
import type { Analyzer } from "./interface";
import type { Anomalies, Cluster, DependencyGraph } from "@/types/graph";

export const DEPENDENCY_GRAPH_ANALYZER_ID = "dependency-graph";
export const FOLDER_CLUSTER_ANALYZER_ID = "folder-clusters";
export const ANOMALY_ANALYZER_ID = "dependency-observations";

export const dependencyGraphAnalyzer: Analyzer<DependencyGraph> = {
  id: DEPENDENCY_GRAPH_ANALYZER_ID,
  name: "Dependency Graph",
  tier: 1,
  requires: [{ capability: "imports", onMissing: "degrade" }],
  analyze: (context) => buildGraph([...context.files]),
};

export const folderClusterAnalyzer: Analyzer<Cluster[]> = {
  id: FOLDER_CLUSTER_ANALYZER_ID,
  name: "Folder Clusters",
  tier: 2,
  dependsOn: [DEPENDENCY_GRAPH_ANALYZER_ID],
  analyze: (context) => {
    const graph = context.getResult<DependencyGraph>(DEPENDENCY_GRAPH_ANALYZER_ID);
    if (!graph) return [];
    return context.architectureModel
      ? clustersFromArchitectureModel(
          context.architectureModel,
          graph,
          context.repositoryIR ?? undefined,
        )
      : clusterByFolder(graph);
  },
};

export const anomalyAnalyzer: Analyzer<Anomalies> = {
  id: ANOMALY_ANALYZER_ID,
  name: "Dependency Observations",
  tier: 2,
  dependsOn: [DEPENDENCY_GRAPH_ANALYZER_ID],
  requires: [{ capability: "imports", onMissing: "degrade" }],
  analyze: (context) => {
    const graph = context.getResult<DependencyGraph>(DEPENDENCY_GRAPH_ANALYZER_ID);
    return graph
      ? detectAnomalies(graph)
      : { cycles: [], godModules: [], orphans: [] };
  },
};

export function createBuiltInAnalyzerRegistry() {
  const registry = new AnalyzerRegistry();
  registry.register(dependencyGraphAnalyzer);
  registry.register(folderClusterAnalyzer);
  registry.register(anomalyAnalyzer);
  return registry;
}
