import type { Anomalies, DependencyGraph } from "@/types/graph";

function canonicalCycle(cycle: string[]): string {
  const openCycle = cycle.slice(0, -1);
  const rotations = openCycle.map((_, index) => [...openCycle.slice(index), ...openCycle.slice(0, index)]);
  return rotations.map((rotation) => rotation.join("\u0000")).sort()[0];
}

function findCycles(graph: DependencyGraph): string[][] {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) adjacency.get(edge.from)?.push(edge.to);

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const knownCycles = new Set<string>();

  const visit = (nodeId: string) => {
    state.set(nodeId, "visiting");
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (state.get(next) === "visiting") {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        const signature = canonicalCycle(cycle);
        if (!knownCycles.has(signature)) {
          knownCycles.add(signature);
          cycles.push(cycle);
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(nodeId, "visited");
  };

  for (const node of graph.nodes) if (!state.has(node.id)) visit(node.id);
  return cycles;
}

export function detectAnomalies(graph: DependencyGraph): Anomalies {
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
    cycles: findCycles(graph),
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
