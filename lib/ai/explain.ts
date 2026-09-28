import type { AnalysisResult, GraphNode } from "@/types/graph";
import { createAiQueryContext } from "./grounding";
import { computeImpact, getNeighbors, getNode } from "./tools";
import type { AiEvidenceCatalog } from "./types";

// Hub files can have hundreds of transitive importers. Every list sent to the
// provider is capped so prompt size stays bounded regardless of repository size.
const MAX_NEIGHBORS = 24;
const MAX_CYCLES = 4;
const MAX_OVERVIEW_NODES = 24;
const MAX_OVERVIEW_CYCLES = 8;
const MAX_EDGES = 64;

export type ExplainPrompt = Readonly<{ prompt: string; allowed: AiEvidenceCatalog }>;

function take(values: Iterable<string>, limit: number): string[] {
  return [...new Set(values)].slice(0, limit);
}

function cycleEdgeIds(cycles: ReadonlyArray<ReadonlyArray<string>>, edgeIds: ReadonlySet<string>, byPair: ReadonlyMap<string, string>): string[] {
  const ids: string[] = [];
  for (const cycle of cycles) {
    // Cycles may or may not repeat their first node at the end; close them either way.
    const closed = cycle[0] === cycle[cycle.length - 1] ? cycle : [...cycle, cycle[0]];
    for (let index = 0; index + 1 < closed.length; index += 1) {
      const id = byPair.get(`${closed[index]}\0${closed[index + 1]}`);
      if (id && edgeIds.has(id)) ids.push(id);
    }
  }
  return ids;
}

export function buildExplainPrompt(result: AnalysisResult, nodeId: string | undefined): ExplainPrompt {
  const context = createAiQueryContext(result);
  const edgeByPair = new Map(result.graph.edges.map((edge) => [`${edge.from}\0${edge.to}`, edge.id]));
  const allEdgeIds = new Set(edgeByPair.values());
  const graphNodeIds = new Set<string>();
  const graphEdgeIds = new Set<string>();
  const facts: Record<string, unknown> = {
    repository: result.repoMeta.repoName,
    language: result.repoMeta.language,
    framework: result.repoMeta.framework,
    files: result.repoMeta.fileCount,
    dependencies: result.repoMeta.dependencyCount,
  };

  if (nodeId) {
    const node = getNode(context, nodeId);
    if (!node.value) throw new Error("The requested file is not part of this analysis.");
    const outgoingAll = getNeighbors(context, nodeId, "outgoing").value;
    const incomingAll = getNeighbors(context, nodeId, "incoming").value;
    const impactAll = computeImpact(context, nodeId).value;
    const outgoing = take(outgoingAll.map((item) => item.id), MAX_NEIGHBORS);
    const incoming = take(incomingAll.map((item) => item.id), MAX_NEIGHBORS);
    const impact = take(impactAll.map((item) => item.id), MAX_NEIGHBORS);
    const cycles = context.query.findCycles().filter((cycle) => cycle.includes(nodeId)).slice(0, MAX_CYCLES);

    for (const id of [nodeId, ...outgoing, ...incoming, ...impact, ...cycles.flat()]) graphNodeIds.add(id);
    for (const id of outgoing) { const edge = edgeByPair.get(`${nodeId}\0${id}`); if (edge) graphEdgeIds.add(edge); }
    for (const id of incoming) { const edge = edgeByPair.get(`${id}\0${nodeId}`); if (edge) graphEdgeIds.add(edge); }
    for (const id of cycleEdgeIds(cycles, allEdgeIds, edgeByPair)) graphEdgeIds.add(id);

    const graphNode = node.value as GraphNode;
    facts.subject = {
      id: nodeId,
      path: graphNode.path,
      lines: graphNode.lineCount,
      externalImports: graphNode.externalImports,
      outgoing: { total: outgoingAll.length, shown: outgoing },
      incoming: { total: incomingAll.length, shown: incoming },
      transitiveImpact: { total: impactAll.length, shown: impact },
      cycles,
    };
  } else {
    const inDegree = new Map<string, number>();
    for (const edge of result.graph.edges) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    const ranked = [...result.graph.nodes]
      .map((node) => ({ node, inDegree: inDegree.get(node.id) ?? 0 }))
      .sort((a, b) => b.inDegree - a.inDegree || a.node.id.localeCompare(b.node.id))
      .slice(0, MAX_OVERVIEW_NODES);
    const cycles = result.anomalies.cycles.slice(0, MAX_OVERVIEW_CYCLES);
    for (const { node } of ranked) graphNodeIds.add(node.id);
    for (const id of cycles.flat()) graphNodeIds.add(id);
    for (const id of cycleEdgeIds(cycles, allEdgeIds, edgeByPair)) graphEdgeIds.add(id);
    for (const edge of result.graph.edges) {
      if (graphEdgeIds.size >= MAX_EDGES) break;
      if (graphNodeIds.has(edge.from) && graphNodeIds.has(edge.to)) graphEdgeIds.add(edge.id);
    }
    facts.subject = "repository overview";
    facts.nodes = ranked.map(({ node, inDegree }) => ({ id: node.id, lines: node.lineCount, inDegree, outDegree: node.imports.length }));
    facts.cycles = cycles;
  }

  const allowed: AiEvidenceCatalog = {
    nodeIds: graphNodeIds,
    edgeIds: new Set(take(graphEdgeIds, MAX_EDGES)),
    analyzerResultIds: new Set((result.analysisViews ?? []).map((view) => view.analyzerId)),
  };
  const allowedIds = { nodes: [...allowed.nodeIds], edges: [...allowed.edgeIds], analyzers: [...allowed.analyzerResultIds] };
  return {
    allowed,
    prompt: [
      "Explain the supplied Cartograph static-analysis evidence.",
      "This is an interpretation, not graph geometry. Do not invent facts, file IDs, or citations.",
      "Lists marked with total/shown are truncated; use the totals when describing size.",
      "Return exactly one JSON object with this shape:",
      '{"answer":"short answer","claims":[{"text":"specific claim","citations":[{"kind":"node|edge|analyzer-result","id":"allowed id"}]}],"uncertainty":"optional limitation"}',
      "Use 2-5 concise claims. Every claim must cite one or more allowed IDs. If evidence is thin, say so in uncertainty.",
      `Allowed citation IDs: ${JSON.stringify(allowedIds)}`,
      `Evidence: ${JSON.stringify(facts)}`,
    ].join("\n"),
  };
}
