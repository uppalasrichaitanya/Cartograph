import type { DependencyGraph, GraphEdge, GraphNode, SourceFileAnalysis } from "@/types/graph";

export function buildGraph(files: SourceFileAnalysis[]): DependencyGraph {
  const fileIds = new Set(files.map((file) => file.filePath));
  const nodes: GraphNode[] = files.map((file) => ({
    id: file.filePath,
    path: file.filePath,
    folder: "",
    lineCount: file.lineCount,
    imports: file.imports.filter((importedFile) => fileIds.has(importedFile)),
    externalImports: file.externalImports,
  }));

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const target of node.imports) {
      edges.push({ id: `${node.id}->${target}`, from: node.id, to: target });
    }
  }

  return { nodes, edges };
}
