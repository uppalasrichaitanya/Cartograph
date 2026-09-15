import { NextResponse } from "next/server";
import { assertGrounded, createAiQueryContext, getNeighbors, getNode, computeImpact } from "@/lib/ai";
import { generateAiResponse } from "@/lib/ai/provider";
import type { AiEvidenceCatalog } from "@/lib/ai/types";
import { getStorage } from "@/lib/storage";
import type { AnalysisResult } from "@/types/graph";
import type { GraphNode } from "@/types/graph";

export const runtime = "nodejs";
export const maxDuration = 45;

type ExplainRequest = Readonly<{
  analysisId?: unknown;
  nodeId?: unknown;
}>;

function trimIds(values: Iterable<string>, limit = 24): string[] {
  return [...new Set(values)].slice(0, limit);
}

function promptFor(
  result: AnalysisResult | null,
  nodeId: string | undefined,
): { prompt: string; allowed: AiEvidenceCatalog } {
  if (!result) throw new Error("Analysis not found.");
  const context = createAiQueryContext(result);
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
    graphNodeIds.add(nodeId);
    const outgoing = getNeighbors(context, nodeId, "outgoing");
    const incoming = getNeighbors(context, nodeId, "incoming");
    const impact = computeImpact(context, nodeId);
    for (const item of [...outgoing.value, ...incoming.value, ...impact.value]) graphNodeIds.add(item.id);
    const cycles = context.query.findCycles().filter((cycle) => cycle.includes(nodeId)).slice(0, 4);
    for (const edge of result.graph.edges) {
      if (graphNodeIds.has(edge.from) && graphNodeIds.has(edge.to)) graphEdgeIds.add(edge.id);
    }
    const graphNode = node.value as GraphNode;
    facts.subject = {
      id: nodeId,
      path: graphNode.path,
      lines: graphNode.lineCount,
      imports: graphNode.imports,
      externalImports: graphNode.externalImports,
      outgoing: trimIds(outgoing.value.map((item) => item.id)),
      incoming: trimIds(incoming.value.map((item) => item.id)),
      transitiveImpact: trimIds(impact.value.map((item) => item.id)),
      cycles,
    };
  } else {
    const ranked = [...result.graph.nodes]
      .map((node) => ({ node, inDegree: result.graph.edges.filter((edge) => edge.to === node.id).length }))
      .sort((a, b) => b.inDegree - a.inDegree || a.node.id.localeCompare(b.node.id))
      .slice(0, 24);
    for (const { node } of ranked) graphNodeIds.add(node.id);
    for (const edge of result.graph.edges) {
      if (graphNodeIds.has(edge.from) && graphNodeIds.has(edge.to)) graphEdgeIds.add(edge.id);
    }
    facts.subject = "repository overview";
    facts.nodes = ranked.map(({ node, inDegree }) => ({ id: node.id, path: node.path, lines: node.lineCount, inDegree, imports: node.imports }));
    facts.cycles = result.anomalies.cycles.slice(0, 8);
  }

  const allowed: AiEvidenceCatalog = {
    nodeIds: new Set(graphNodeIds),
    edgeIds: new Set(graphEdgeIds),
    analyzerResultIds: new Set((result.analysisViews ?? []).map((view) => view.analyzerId)),
  };
  const allowedIds = {
    nodes: [...allowed.nodeIds],
    edges: [...allowed.edgeIds],
    analyzers: [...allowed.analyzerResultIds],
  };
  return {
    allowed,
    prompt: [
      "Explain the supplied Cartograph static-analysis evidence.",
      "This is an interpretation, not graph geometry. Do not invent facts, file IDs, or citations.",
      "Return exactly one JSON object with this shape:",
      '{"answer":"short answer","claims":[{"text":"specific claim","citations":[{"kind":"node|edge|analyzer-result","id":"allowed id"}]}],"uncertainty":"optional limitation"}',
      "Use 2-5 concise claims. Every claim must cite one or more allowed IDs. If evidence is thin, say so in uncertainty.",
      `Allowed citation IDs: ${JSON.stringify(allowedIds)}`,
      `Evidence: ${JSON.stringify(facts)}`,
    ].join("\n"),
  };
}

export async function POST(request: Request) {
  let body: ExplainRequest;
  try {
    body = (await request.json()) as ExplainRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }
  if (typeof body.analysisId !== "string" || !body.analysisId.trim()) {
    return NextResponse.json({ error: "analysisId is required." }, { status: 400 });
  }
  if (body.nodeId !== undefined && typeof body.nodeId !== "string") {
    return NextResponse.json({ error: "nodeId must be a string when provided." }, { status: 400 });
  }

  const result = await getStorage().loadAnalysis(body.analysisId);
  if (!result) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });

  try {
    const { prompt, allowed } = promptFor(result, body.nodeId as string | undefined);
    const generated = await generateAiResponse(prompt);
    assertGrounded(generated.response, allowed);
    return NextResponse.json({ ...generated.response, provider: generated.provider, model: generated.model });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI explanation failed." },
      { status: 502 },
    );
  }
}
