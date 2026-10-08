import { createHash } from "node:crypto";
import { isTestPath } from "@/lib/analysis/folderTree";
import type { AnalysisResult, GraphNode } from "@/types/graph";
import { createAiQueryContext, dropUnsupportedFigures, evidenceNumbers, validateCitation } from "./grounding";
import { computeImpact, getNeighbors } from "./tools";
import type { AiEvidenceCatalog, AiResponse, ReadingStep } from "./types";

/**
 * What an explanation is about. Precedence in the workspace is
 * file > region > repository, matching what the reader is looking at.
 */
export type ExplainSubject =
  | Readonly<{ kind: "overview" }>
  | Readonly<{ kind: "region"; id: string }>
  | Readonly<{ kind: "file"; id: string }>;

/** Bumped whenever the prompt or evidence shape changes, so cached answers are not reused. */
export const EXPLAIN_PROMPT_VERSION = 5;

export const EXPLAIN_SECTIONS: Readonly<Record<ExplainSubject["kind"], ReadonlyArray<string>>> = {
  overview: ["What this project is", "How it is organized", "How the pieces connect", "Hotspots and risks"],
  region: ["Role", "Key files", "Connections", "Hotspots and risks"],
  file: ["Role", "What it relies on", "What relies on it", "Change impact"],
};

// Hub files can have hundreds of importers. Every list sent to the provider is
// capped so prompt size stays bounded regardless of repository size.
const LIMITS = {
  neighbors: 20,
  impact: 16,
  cycles: 4,
  hubs: 10,
  entryPoints: 8,
  largest: 5,
  regions: 12,
  regionFiles: 20,
  subfolders: 8,
  crossEdges: 12,
  externals: 12,
  declarationsPerFile: 6,
  subjectDeclarations: 24,
  edges: 64,
  readingOrder: 6,
} as const;

export type ExplainPrompt = Readonly<{
  prompt: string;
  allowed: AiEvidenceCatalog;
  subject: ExplainSubject;
  /** Figures the model may state; see dropUnsupportedFigures. */
  figures: ReadonlySet<string>;
}>;

export function explanationCacheKey(subject: ExplainSubject): string {
  const id = subject.kind === "overview" ? "" : subject.id;
  return createHash("sha256").update(`v${EXPLAIN_PROMPT_VERSION}\0${subject.kind}\0${id}`).digest("hex");
}

function top<T>(items: Iterable<T>, limit: number, score: (item: T) => number, tieBreak: (item: T) => string): T[] {
  return [...items].sort((a, b) => score(b) - score(a) || tieBreak(a).localeCompare(tieBreak(b))).slice(0, limit);
}

function countBy(values: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function topCounts(counts: ReadonlyMap<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(top(counts.entries(), limit, ([, count]) => count, ([name]) => name));
}

/** Directory prefix `depth` segments below `base` (or the file's own folder when shallower). */
function subfolder(path: string, base: string, depth: number): string {
  const segments = path.split("/").slice(0, -1);
  const baseDepth = base ? base.split("/").length : 0;
  return segments.slice(0, Math.min(segments.length, baseDepth + depth)).join("/") || "(root)";
}

/** Precomputed, read-only views of one analysis shared by every subject builder. */
function indexAnalysis(result: AnalysisResult) {
  const nodes = new Map(result.graph.nodes.map((node) => [node.id, node]));
  const inDegree = countBy(result.graph.edges.map((edge) => edge.to));
  const outDegree = countBy(result.graph.edges.map((edge) => edge.from));
  const edgeByPair = new Map(result.graph.edges.map((edge) => [`${edge.from}\0${edge.to}`, edge.id]));
  const declarations = new Map<string, ReadonlyArray<{ name: string; kind: string }>>();
  for (const node of result.repositoryIR?.nodes ?? []) {
    if (node.kind === "File" && node.declarations?.length) {
      declarations.set(node.path, node.declarations.map((declaration) => ({ name: declaration.name, kind: declaration.kind })));
    }
  }
  const regionNames = new Set(result.clusters.map((cluster) => cluster.name));
  return { nodes, inDegree, outDegree, edgeByPair, declarations, regionNames };
}

type AnalysisIndex = ReturnType<typeof indexAnalysis>;

function declaredNames(index: AnalysisIndex, node: GraphNode, limit: number): string[] | undefined {
  const names = index.declarations.get(node.path)?.map((declaration) => declaration.name);
  return names?.length ? names.slice(0, limit) : undefined;
}

function fileSummary(index: AnalysisIndex, node: GraphNode) {
  return {
    id: node.id,
    lines: node.lineCount,
    importedBy: index.inDegree.get(node.id) ?? 0,
    imports: index.outDegree.get(node.id) ?? 0,
    declares: declaredNames(index, node, LIMITS.declarationsPerFile),
  };
}

/** Adds the edges of each cycle (closed or open form) that exist in the graph. */
function addCycleEdges(cycles: ReadonlyArray<ReadonlyArray<string>>, index: AnalysisIndex, into: Set<string>): void {
  for (const cycle of cycles) {
    const closed = cycle[0] === cycle[cycle.length - 1] ? cycle : [...cycle, cycle[0]];
    for (let position = 0; position + 1 < closed.length; position += 1) {
      const id = index.edgeByPair.get(`${closed[position]}\0${closed[position + 1]}`);
      if (id) into.add(id);
    }
  }
}

type Evidence = { facts: Record<string, unknown>; nodeIds: Set<string>; edgeIds: Set<string>; regionIds: Set<string> };

function repositoryFacts(result: AnalysisResult): Record<string, unknown> {
  return {
    repository: result.repoMeta.repoName,
    language: result.repoMeta.language,
    framework: result.repoMeta.framework,
    sourceFiles: result.repoMeta.fileCount,
    internalImportEdges: result.graph.edges.length,
  };
}

function overviewEvidence(result: AnalysisResult, index: AnalysisIndex): Evidence {
  const evidence: Evidence = { facts: repositoryFacts(result), nodeIds: new Set(), edgeIds: new Set(), regionIds: new Set(index.regionNames) };
  const nodes = result.graph.nodes;
  const production = nodes.filter((node) => !isTestPath(node.path));
  const hubs = top(production, LIMITS.hubs, (node) => index.inDegree.get(node.id) ?? 0, (node) => node.id)
    .filter((node) => (index.inDegree.get(node.id) ?? 0) > 0);
  const entryPoints = top(
    production.filter((node) => !index.inDegree.get(node.id) && index.outDegree.get(node.id)),
    LIMITS.entryPoints, (node) => index.outDegree.get(node.id) ?? 0, (node) => node.id,
  );
  const largest = top(production, LIMITS.largest, (node) => node.lineCount, (node) => node.id);
  const cycles = result.anomalies.cycles.slice(0, LIMITS.cycles * 2);

  const regionOf = new Map(nodes.map((node) => [node.id, node.folder]));
  const regionEdges = countBy(result.graph.edges
    .filter((edge) => regionOf.get(edge.from) !== regionOf.get(edge.to))
    .map((edge) => `${regionOf.get(edge.from)}\0${regionOf.get(edge.to)}`));
  const regions = top(result.clusters, LIMITS.regions, (cluster) => cluster.fileIds.length, (cluster) => cluster.name).map((cluster) => {
    const members = cluster.fileIds.map((id) => index.nodes.get(id)).filter((node): node is GraphNode => Boolean(node));
    const dependsOn = new Map<string, number>();
    const usedBy = new Map<string, number>();
    for (const [pair, count] of regionEdges) {
      const [from, to] = pair.split("\0");
      if (from === cluster.name) dependsOn.set(to, count);
      if (to === cluster.name) usedBy.set(from, count);
    }
    return {
      id: cluster.name,
      files: members.length,
      lines: members.reduce((sum, node) => sum + node.lineCount, 0),
      testFiles: members.filter((node) => isTestPath(node.path)).length,
      subfolders: topCounts(countBy(members.map((node) => subfolder(node.path, "", 2))), LIMITS.subfolders),
      dependsOnRegions: topCounts(dependsOn, 4),
      usedByRegions: topCounts(usedBy, 4),
    };
  });

  const externals = countBy(nodes.flatMap((node) => [...new Set(node.externalImports)]));
  for (const node of [...hubs, ...entryPoints, ...largest]) evidence.nodeIds.add(node.id);
  for (const id of cycles.flat()) evidence.nodeIds.add(id);
  addCycleEdges(cycles, index, evidence.edgeIds);
  for (const edge of result.graph.edges) {
    if (evidence.edgeIds.size >= LIMITS.edges) break;
    if (evidence.nodeIds.has(edge.from) && evidence.nodeIds.has(edge.to)) evidence.edgeIds.add(edge.id);
  }

  Object.assign(evidence.facts, {
    subject: "repository overview",
    testFiles: nodes.length - production.length,
    regions,
    mostImportedFiles: hubs.map((node) => fileSummary(index, node)),
    likelyEntryPoints: entryPoints.map((node) => fileSummary(index, node)),
    largestFiles: largest.map((node) => ({ id: node.id, lines: node.lineCount })),
    externalPackagesByImportingFiles: topCounts(externals, LIMITS.externals),
    importCycles: { total: result.anomalies.cycles.length, shown: cycles },
    filesNothingImports: result.anomalies.orphans.filter((id) => !isTestPath(id)).length,
    // Only when entry points were recognised: with none, the search never ran.
    ...(result.reachability && result.reachability.entryPoints.length > 0
      ? {
          recognisedEntryPoints: result.reachability.entryPoints.length,
          notReachableFromEntryPoints: result.reachability.unreachable.filter((id) => !isTestPath(id)).length,
          // What could make that count wrong; state it when relaying the figure.
          reachabilityCaveats: result.reachability.caveats,
        }
      : {}),
    filesThatFailedToParse: result.parseErrors.length,
  });
  return evidence;
}

function regionEvidence(result: AnalysisResult, index: AnalysisIndex, regionId: string): Evidence {
  const cluster = result.clusters.find((candidate) => candidate.name === regionId);
  if (!cluster) throw new ExplainSubjectError("The requested region is not part of this analysis.");
  const evidence: Evidence = { facts: repositoryFacts(result), nodeIds: new Set(), edgeIds: new Set(), regionIds: new Set(index.regionNames) };
  const memberIds = new Set(cluster.fileIds);
  const members = cluster.fileIds.map((id) => index.nodes.get(id)).filter((node): node is GraphNode => Boolean(node));
  const keyFiles = top(members, LIMITS.regionFiles, (node) => (index.inDegree.get(node.id) ?? 0) * 1000 + node.lineCount, (node) => node.id);
  const outgoing = result.graph.edges.filter((edge) => memberIds.has(edge.from) && !memberIds.has(edge.to));
  const incoming = result.graph.edges.filter((edge) => !memberIds.has(edge.from) && memberIds.has(edge.to));
  const regionOf = (id: string) => index.nodes.get(id)?.folder ?? "other";
  const shownOut = outgoing.slice(0, LIMITS.crossEdges);
  const shownIn = incoming.slice(0, LIMITS.crossEdges);
  const cycles = result.anomalies.cycles.filter((cycle) => cycle.some((id) => memberIds.has(id))).slice(0, LIMITS.cycles);
  const entryPoints = members.filter((node) => !isTestPath(node.path) && !index.inDegree.get(node.id) && index.outDegree.get(node.id));

  for (const node of keyFiles) evidence.nodeIds.add(node.id);
  for (const edge of [...shownOut, ...shownIn]) {
    evidence.nodeIds.add(edge.from);
    evidence.nodeIds.add(edge.to);
    evidence.edgeIds.add(edge.id);
  }
  for (const id of cycles.flat()) evidence.nodeIds.add(id);
  for (const node of entryPoints.slice(0, LIMITS.entryPoints)) evidence.nodeIds.add(node.id);
  addCycleEdges(cycles, index, evidence.edgeIds);

  Object.assign(evidence.facts, {
    subject: { region: cluster.name },
    files: members.length,
    testFiles: members.filter((node) => isTestPath(node.path)).length,
    lines: members.reduce((sum, node) => sum + node.lineCount, 0),
    subfolders: topCounts(countBy(members.map((node) => subfolder(node.path, cluster.name === "other" ? "" : cluster.name, 1))), LIMITS.subfolders),
    keyFiles: keyFiles.map((node) => fileSummary(index, node)),
    likelyEntryPoints: entryPoints.slice(0, LIMITS.entryPoints).map((node) => node.id),
    dependsOnRegions: topCounts(countBy(outgoing.map((edge) => regionOf(edge.to))), 6),
    usedByRegions: topCounts(countBy(incoming.map((edge) => regionOf(edge.from))), 6),
    importsLeavingRegion: { total: outgoing.length, shown: shownOut.map((edge) => edge.id) },
    importsEnteringRegion: { total: incoming.length, shown: shownIn.map((edge) => edge.id) },
    externalPackagesByImportingFiles: topCounts(countBy(members.flatMap((node) => [...new Set(node.externalImports)])), LIMITS.externals),
    importCycles: cycles,
  });
  return evidence;
}

function fileEvidence(result: AnalysisResult, index: AnalysisIndex, nodeId: string): Evidence {
  const node = index.nodes.get(nodeId);
  if (!node) throw new ExplainSubjectError("The requested file is not part of this analysis.");
  const context = createAiQueryContext(result);
  const evidence: Evidence = { facts: repositoryFacts(result), nodeIds: new Set([nodeId]), edgeIds: new Set(), regionIds: new Set() };
  const outgoingAll = getNeighbors(context, nodeId, "outgoing").value.map((item) => item.id);
  const incomingAll = getNeighbors(context, nodeId, "incoming").value.map((item) => item.id);
  const directImporters = new Set(incomingAll);
  const indirectAll = computeImpact(context, nodeId).value.map((item) => item.id).filter((id) => !directImporters.has(id) && id !== nodeId);
  const outgoing = outgoingAll.slice(0, LIMITS.neighbors);
  const incoming = incomingAll.slice(0, LIMITS.neighbors);
  const indirect = indirectAll.slice(0, LIMITS.impact);
  const cycles = context.query.findCycles().filter((cycle) => cycle.includes(nodeId)).slice(0, LIMITS.cycles);
  const rank = [...index.nodes.values()].filter((other) => (index.inDegree.get(other.id) ?? 0) > (index.inDegree.get(nodeId) ?? 0)).length + 1;
  const neighbor = (id: string) => {
    const other = index.nodes.get(id);
    return other ? { id, declares: declaredNames(index, other, 3) } : { id };
  };

  for (const id of [...outgoing, ...incoming, ...indirect, ...cycles.flat()]) evidence.nodeIds.add(id);
  for (const id of outgoing) { const edge = index.edgeByPair.get(`${nodeId}\0${id}`); if (edge) evidence.edgeIds.add(edge); }
  for (const id of incoming) { const edge = index.edgeByPair.get(`${id}\0${nodeId}`); if (edge) evidence.edgeIds.add(edge); }
  addCycleEdges(cycles, index, evidence.edgeIds);
  for (const id of evidence.nodeIds) {
    const folder = index.nodes.get(id)?.folder;
    if (folder) evidence.regionIds.add(folder);
  }

  Object.assign(evidence.facts, {
    subject: {
      id: nodeId,
      region: node.folder,
      lines: node.lineCount,
      isTest: isTestPath(node.path),
      declares: index.declarations.get(node.path)?.slice(0, LIMITS.subjectDeclarations),
      externalPackages: node.externalImports.slice(0, LIMITS.externals),
      importedByRank: { rank, of: index.nodes.size },
    },
    imports: { total: outgoingAll.length, shown: outgoing.map(neighbor) },
    importedBy: { total: incomingAll.length, shown: incoming.map(neighbor) },
    indirectlyAffected: { total: indirectAll.length, shown: indirect },
    importCycles: cycles,
  });
  return evidence;
}

export class ExplainSubjectError extends Error {}

const SUBJECT_GUIDANCE: Readonly<Record<ExplainSubject["kind"], string>> = {
  overview: "Give a newcomer a guided tour of the whole repository: what it likely does, how its regions divide the work, how they depend on each other, and where complexity concentrates. readingOrder should be the best files to open first to understand the system.",
  region: "Explain what this region (a folder group) is responsible for, which of its files matter most, and how it connects to the rest of the codebase. readingOrder should be the files to open first to understand this region.",
  file: "Explain what this file is for, what it relies on, what relies on it, and what could break if it changes. readingOrder should be the files to read next to understand this file in context.",
};

export function buildExplainPrompt(result: AnalysisResult, subject: ExplainSubject): ExplainPrompt {
  const index = indexAnalysis(result);
  const evidence =
    subject.kind === "file" ? fileEvidence(result, index, subject.id)
    : subject.kind === "region" ? regionEvidence(result, index, subject.id)
    : overviewEvidence(result, index);

  const allowed: AiEvidenceCatalog = {
    nodeIds: evidence.nodeIds,
    edgeIds: new Set([...evidence.edgeIds].slice(0, LIMITS.edges)),
    regionIds: evidence.regionIds,
    analyzerResultIds: new Set((result.analysisViews ?? []).map((view) => view.analyzerId)),
  };
  const allowedIds = {
    node: [...allowed.nodeIds],
    edge: [...allowed.edgeIds],
    region: [...(allowed.regionIds ?? [])],
  };
  const sections = EXPLAIN_SECTIONS[subject.kind];
  return {
    subject,
    allowed,
    figures: evidenceNumbers(evidence.facts),
    prompt: [
      "Explain the supplied Cartograph static-analysis evidence to a developer who is new to this codebase.",
      SUBJECT_GUIDANCE[subject.kind],
      "",
      "Rules:",
      "- Write plain text without Markdown. Use plain language. Infer purpose from paths, declared names, and connections, and phrase inferences as such (\"likely\", \"appears to\").",
      "- Only state figures that appear in the evidence. Lists shaped {total, shown} are truncated: use total for counts.",
      "- internalImportEdges are import statements between repository files, not external packages.",
      "- A file with no import path from a recognised entry point may be described as \"not reachable from recognised entry points\" and nothing stronger; never call a file dead or unused, because it may be loaded in ways the analysis cannot see.",
      "- Every claim must cite at least one allowed ID. Citation kinds: node (a file ID), edge (an import ID), region (a region name).",
      "- If evidence is thin or a role is a guess, say so in uncertainty.",
      "",
      "Return exactly one JSON object with this shape:",
      '{"summary":"2-4 sentence plain-language overview","claims":[{"section":"one of the sections","text":"one specific point","citations":[{"kind":"node|edge|region","id":"allowed id"}]}],"readingOrder":[{"id":"allowed node id","reason":"why read it"}],"uncertainty":"optional limitation"}',
      `Sections, in order, each with 1-3 claims: ${JSON.stringify(sections)}`,
      `readingOrder: 3-${LIMITS.readingOrder} files, most useful first.`,
      `Allowed citation IDs: ${JSON.stringify(allowedIds)}`,
      `Evidence: ${JSON.stringify(evidence.facts)}`,
    ].join("\n"),
  };
}

export type FinalizedExplanation = Readonly<{ response: AiResponse; dropped: number }>;

/**
 * Keeps only what the evidence supports: claims whose citations all resolve
 * and whose figures appear in the evidence, and reading steps that name
 * cited files. Throws when nothing useful survives, so the provider chain
 * moves on to the next provider.
 */
export function finalizeExplanation(response: AiResponse, prompt: ExplainPrompt): FinalizedExplanation {
  const cited = response.claims.filter((claim) =>
    claim.text && claim.citations.length > 0 && claim.citations.every((citation) => validateCitation(citation, prompt.allowed)));
  const figures = dropUnsupportedFigures({ ...response, claims: cited }, prompt.figures);
  const sections = new Set(EXPLAIN_SECTIONS[prompt.subject.kind]);
  const claims = figures.response.claims.map((claim) =>
    claim.section && sections.has(claim.section) ? claim : { ...claim, section: "Other observations" });

  const seen = new Set<string>();
  const readingOrder: ReadingStep[] = [];
  for (const step of response.readingOrder ?? []) {
    if (readingOrder.length >= LIMITS.readingOrder) break;
    if (!prompt.allowed.nodeIds.has(step.id) || seen.has(step.id)) continue;
    seen.add(step.id);
    readingOrder.push(step);
  }

  if (!figures.response.answer) throw new Error("Explanation summary was empty or stated unsupported figures.");
  if (claims.length === 0) throw new Error("No claim in the explanation was grounded in the evidence.");
  return {
    response: {
      answer: figures.response.answer,
      claims,
      ...(response.uncertainty ? { uncertainty: response.uncertainty } : {}),
      ...(readingOrder.length ? { readingOrder } : {}),
    },
    dropped: response.claims.length - claims.length,
  };
}
