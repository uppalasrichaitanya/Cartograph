import type { Anomalies, DependencyGraph } from "@/types/graph";
import { createGraphQuery } from "./query";

export function detectAnomalies(graph: DependencyGraph): Anomalies {
  const query = createGraphQuery(graph);
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  const degrees = graph.nodes.map((node) => incoming.get(node.id) ?? 0).sort((a, b) => a - b);
  const threshold =
    graph.nodes.length < 20
      ? 15
      : degrees[Math.min(degrees.length - 1, Math.ceil(degrees.length * 0.95) - 1)] ?? 0;

  return {
    cycles: query.findCycles().map((cycle) => [...cycle]),
    godModules: graph.nodes
      .filter((node) => {
        const inDegree = incoming.get(node.id) ?? 0;
        return graph.nodes.length < 20 ? inDegree > threshold : inDegree > 0 && inDegree >= threshold;
      })
      .map((node) => ({ filePath: node.path, inDegree: incoming.get(node.id) ?? 0 }))
      .sort((a, b) => b.inDegree - a.inDegree || a.filePath.localeCompare(b.filePath)),
    // Files nothing in this repository imports.
    //
    // Widened from "in-degree 0 AND out-degree 0" (fully disconnected) to
    // in-degree alone. The stricter test could not surface the cases that
    // matter most here: an entry point or a CLI root imports plenty, so it had
    // out-degree and never appeared — yet "nothing imports this" is exactly
    // what is true of it, and exactly what someone reading the map wants to
    // know.
    //
    // Out-degree is not evidence about whether a file is imported. Requiring
    // it to be zero was answering a narrower question ("connected to nothing")
    // than the one being asked.
    //
    // This reports an observation, not a fault: entry points, CLI roots, and
    // route files are legitimately unimported, and the interface says so.
    orphans: graph.nodes
      .filter((node) => (incoming.get(node.id) ?? 0) === 0)
      .map((node) => node.path)
      .sort(),
  };
}
