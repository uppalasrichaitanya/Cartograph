/**
 * The diagram model: what boxes, containers and arrows a figure has.
 *
 * Built only from measured facts. Boxes follow the repository's own folder
 * lines (the same rule adaptive regions use), arrows aggregate file-level
 * import edges, and anything left out is counted so the figure can say so.
 *
 * @module lib/diagram/model
 */
import { builtinModules } from "node:module";
import { REGION_LIMITS } from "@/lib/analysis/clusterByFolder";
import { buildFolderTree, isTestPath, type FolderTreeNode } from "@/lib/analysis/folderTree";
import { collectUnresolvedImports, projectConfidenceByPath } from "@/lib/analysis/projectConfidence";
import type { AnalysisResult, GeometryConfidence, GraphNode } from "@/types/graph";
import { runDiagramChecks, sharedParts } from "./checks";
import { BUDGETS } from "./metrics";
import type { DiagramEdge, DiagramGroup, DiagramModel, DiagramOptions, DiagramUnit } from "./types";

export class DiagramScopeError extends Error {}

export type DiagramEvidence = Readonly<{
  confidence: ReadonlyMap<string, GeometryConfidence>;
  /** Unresolved import count per file path. */
  unresolved: ReadonlyMap<string, number>;
  partial: boolean;
}>;

const byString = (a: string, b: string) => a.localeCompare(b);
const MAX_NESTING = 2;
const MAX_EXTERNALS = 8;
const MAX_SAMPLES = 5;

export function evidenceFor(result: AnalysisResult): DiagramEvidence {
  const ir = result.repositoryIR ?? null;
  const unresolved = new Map<string, number>();
  for (const [file, refs] of collectUnresolvedImports(ir)) unresolved.set(file, refs.length);
  return {
    confidence: projectConfidenceByPath(ir, result.graph.nodes.map((node) => node.path), result.parseErrors),
    unresolved,
    partial: ir === null,
  };
}

/** A unit before its figures are computed. */
type Draft = {
  id: string;
  kind: DiagramUnit["kind"];
  label: string;
  path: string;
  groupId: string | null;
  depth: number;
  files: string[];
  folder: FolderTreeNode | null;
  side?: "in" | "out";
  /** Boundary units stand for files that are not drawn; this is their count. */
  fileCount?: number;
};

type Built = {
  groups: DiagramGroup[];
  drafts: Draft[];
  /** Extra edges not derivable from unit membership (boundary, unresolved): key "from\0to". */
  extraEdges: Map<string, { count: number; samples: string[] }>;
  omittedFiles: number;
  hiddenTests: number;
  oversizedUnitIds: string[];
  title: string;
  subtitle: string;
  includedFiles: string[];
};

const PYTHON_STDLIB = new Set([
  "abc", "argparse", "asyncio", "base64", "collections", "contextlib", "copy", "csv", "dataclasses", "datetime",
  "enum", "functools", "glob", "hashlib", "heapq", "importlib", "inspect", "io", "itertools", "json", "logging",
  "math", "multiprocessing", "os", "pathlib", "pickle", "random", "re", "shutil", "signal", "socket", "sqlite3",
  "statistics", "string", "subprocess", "sys", "tempfile", "threading", "time", "traceback", "typing", "unittest",
  "urllib", "uuid", "warnings", "weakref", "__future__",
]);
const NODE_BUILTINS = new Set(builtinModules);

export function packageName(specifier: string, language: string | null): string | null {
  if (!specifier) return null;
  if (language === "Go") {
    const segments = specifier.split("/");
    if (!segments[0].includes(".")) return null; // Go standard library paths have no domain.
    return segments.slice(0, 3).join("/");
  }
  if (language === "Python") {
    const root = specifier.split(".")[0];
    return !root || PYTHON_STDLIB.has(root) ? null : root;
  }
  if (specifier.startsWith("node:")) return null;
  const segments = specifier.split("/");
  const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  return NODE_BUILTINS.has(name) ? null : name;
}

function folderDraft(node: FolderTreeNode, groupId: string | null, depth: number, label: string): Draft {
  return { id: `u:${node.path}`, kind: "folder", label, path: node.path, groupId, depth, files: [...node.allFiles], folder: node };
}

function looseDraft(path: string, files: string[], groupId: string | null, depth: number): Draft {
  return { id: `u:${path}#files`, kind: "loose-files", label: path ? `${path}/*` : "(root files)", path, groupId, depth, files, folder: null };
}

function topLevelDrafts(tree: FolderTreeNode): Draft[] {
  const drafts: Draft[] = [];
  for (const child of tree.children) {
    // Match region naming: `src/<x>` folders are top-level boundaries of their own.
    if (child.path === "src" && child.children.length > 0) {
      for (const grandchild of child.children) drafts.push(folderDraft(grandchild, null, 0, grandchild.path));
      if (child.ownFiles.length > 0) drafts.push(looseDraft("src", [...child.ownFiles], null, 0));
    } else {
      drafts.push(folderDraft(child, null, 0, child.path));
    }
  }
  if (tree.ownFiles.length > 0) drafts.push(looseDraft("", [...tree.ownFiles], null, 0));
  return drafts;
}

function mergeSmallest(drafts: Draft[], budget: number): Draft[] {
  if (drafts.length <= budget) return drafts;
  const bySize = [...drafts].sort((a, b) => a.files.length - b.files.length || byString(a.id, b.id));
  const merged = bySize.slice(0, drafts.length - budget + 1);
  const mergedIds = new Set(merged.map((draft) => draft.id));
  return [
    ...drafts.filter((draft) => !mergedIds.has(draft.id)),
    {
      id: "u:#small", kind: "loose-files", label: `${merged.length} small folders`, path: "", groupId: null, depth: 0,
      files: merged.flatMap((draft) => draft.files).sort(byString), folder: null,
    },
  ];
}

function expansionParts(draft: Draft): Draft[] {
  const folder = draft.folder;
  if (!folder || draft.kind !== "folder") return [];
  const qualifying = folder.children.filter((child) => child.allFiles.length >= REGION_LIMITS.minRegionFiles);
  if (qualifying.length < 2) return [];
  const groupId = `g:${folder.path}`;
  const taken = new Set(qualifying.flatMap((child) => child.allFiles));
  const rest = folder.allFiles.filter((file) => !taken.has(file));
  return [
    ...qualifying.map((child) => folderDraft(child, groupId, draft.depth + 1, child.name)),
    ...(rest.length > 0 ? [looseDraft(folder.path, rest, groupId, draft.depth + 1)] : []),
  ];
}

function repositoryUnits(result: AnalysisResult, options: DiagramOptions): Built {
  const all = result.graph.nodes.map((node) => node.path);
  const included = options.includeTests ? all : all.filter((path) => !isTestPath(path));
  const tree = buildFolderTree(included);
  const budget = BUDGETS[options.preset].units;
  let drafts = mergeSmallest(topLevelDrafts(tree), budget);
  const groups: DiagramGroup[] = [];

  if (options.detail === "standard") {
    for (;;) {
      const next = drafts
        .filter((draft) => draft.depth < MAX_NESTING)
        .map((draft) => ({ draft, parts: expansionParts(draft) }))
        .filter(({ parts }) => parts.length >= 2 && drafts.length - 1 + parts.length <= budget)
        .sort((a, b) => b.draft.files.length - a.draft.files.length || byString(a.draft.path, b.draft.path))[0];
      if (!next) break;
      groups.push({
        id: `g:${next.draft.path}`, path: next.draft.path, label: next.draft.label,
        parentId: next.draft.groupId, files: next.draft.files.length,
      });
      drafts = [...drafts.filter((draft) => draft !== next.draft), ...next.parts];
    }
  }

  const oversizedUnitIds = drafts
    .filter((draft) => draft.kind === "folder" && draft.files.length > 60 && expansionParts(draft).length < 2)
    .map((draft) => draft.id);
  const language = result.repoMeta.language ? ` · ${result.repoMeta.language}` : "";
  const includedSet = new Set(included);
  const imports = result.graph.edges.filter((edge) => includedSet.has(edge.from) && includedSet.has(edge.to)).length;
  return {
    groups,
    drafts,
    extraEdges: new Map(),
    omittedFiles: 0,
    hiddenTests: all.length - included.length,
    oversizedUnitIds,
    title: result.repoMeta.repoName,
    subtitle: `Architecture overview · ${included.length} files · ${imports} imports${language}`,
    includedFiles: included,
  };
}

/** Tarjan's strongly connected components over unit ids. */
function stronglyConnected(ids: ReadonlyArray<string>, edges: ReadonlyArray<{ from: string; to: string }>): string[][] {
  const next = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) next.get(edge.from)?.push(edge.to);
  for (const targets of next.values()) targets.sort(byString);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let counter = 0;
  const visit = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of next.get(id) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
      }
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component.sort(byString));
    }
  };
  for (const id of [...ids].sort(byString)) if (!index.has(id)) visit(id);
  return components;
}

function finish(result: AnalysisResult, options: DiagramOptions, evidence: DiagramEvidence, built: Built): DiagramModel {
  const nodes = new Map<string, GraphNode>(result.graph.nodes.map((node) => [node.path, node]));
  const unitOfFile = new Map<string, string>();
  for (const draft of built.drafts) for (const file of draft.files) unitOfFile.set(file, draft.id);

  const aggregated = new Map<string, { count: number; samples: string[] }>();
  const internal = new Map<string, number>();
  for (const edge of result.graph.edges) {
    const from = unitOfFile.get(edge.from);
    const to = unitOfFile.get(edge.to);
    if (!from || !to) continue;
    if (from === to) {
      internal.set(from, (internal.get(from) ?? 0) + 1);
      continue;
    }
    const key = `${from}\0${to}`;
    const entry = aggregated.get(key) ?? { count: 0, samples: [] };
    entry.count += 1;
    entry.samples.push(edge.id);
    aggregated.set(key, entry);
  }
  for (const [key, extra] of built.extraEdges) {
    const entry = aggregated.get(key) ?? { count: 0, samples: [] };
    entry.count += extra.count;
    entry.samples.push(...extra.samples);
    aggregated.set(key, entry);
  }

  const unitIds = built.drafts.map((draft) => draft.id);
  const components = stronglyConnected(unitIds, [...aggregated.keys()].map((key) => {
    const [from, to] = key.split("\0");
    return { from, to };
  }));
  const componentOf = new Map<string, number>();
  components.forEach((component, position) => component.forEach((id) => componentOf.set(id, position)));
  const cyclic = new Set(components.filter((component) => component.length > 1).flat());

  const allEdges: DiagramEdge[] = [...aggregated.entries()].map(([key, entry]) => {
    const [from, to] = key.split("\0");
    return {
      id: `e:${from}->${to}`,
      mutual: aggregated.has(`${to}\0${from}`),
      from,
      to,
      count: entry.count,
      sampleEdgeIds: [...entry.samples].sort(byString).slice(0, MAX_SAMPLES),
      inCycle: cyclic.has(from) && componentOf.get(from) === componentOf.get(to),
    };
  }).sort((a, b) => byString(a.id, b.id));

  // Shared parts (imported by most others) are drawn as a count, not as a fan of arrows.
  const shared = options.scope.kind === "repository" ? sharedParts(built.drafts, allEdges) : new Map<string, number>();
  // A mutual pair with a shared part is set aside too: with the shared part on the right edge, its
  // arrow back would run against the flow and loop around the figure. The cycle finding still reports it.
  const setAside = (edge: DiagramEdge) => shared.has(edge.to) || (edge.mutual && shared.has(edge.from));
  const sharedEdges = allEdges.filter(setAside);
  const drawable = allEdges.filter((edge) => !setAside(edge));

  // Mutual pairs always survive; the heaviest of the rest fill the budget.
  const edgeBudget = BUDGETS[options.preset].edges;
  const mutualEdges = drawable.filter((edge) => edge.mutual);
  const others = drawable.filter((edge) => !edge.mutual).sort((a, b) => b.count - a.count || byString(a.id, b.id));
  const kept = [...mutualEdges, ...others.slice(0, Math.max(0, edgeBudget - mutualEdges.length))];
  const keptIds = new Set(kept.map((edge) => edge.id));
  const dropped = drawable.filter((edge) => !keptIds.has(edge.id));

  const units: DiagramUnit[] = built.drafts.map((draft) => ({
    id: draft.id,
    kind: draft.kind,
    label: draft.label,
    path: draft.path,
    groupId: draft.groupId,
    files: draft.fileCount ?? draft.files.length,
    lines: draft.files.reduce((sum, file) => sum + (nodes.get(file)?.lineCount ?? 0), 0),
    testFiles: draft.files.filter(isTestPath).length,
    reducedConfidence: draft.files.filter((file) => (evidence.confidence.get(file) ?? "verified") !== "verified").length,
    internalImports: internal.get(draft.id) ?? 0,
    inCycle: cyclic.has(draft.id),
    ...(shared.has(draft.id) ? { sharedBy: shared.get(draft.id) } : {}),
    ...(draft.side ? { side: draft.side } : {}),
  })).sort((a, b) => byString(a.id, b.id));

  const packageCounts = new Map<string, number>();
  for (const file of built.includedFiles) {
    const names = new Set((nodes.get(file)?.externalImports ?? [])
      .map((specifier) => packageName(specifier, result.repoMeta.language))
      .filter((name): name is string => name !== null));
    for (const name of names) packageCounts.set(name, (packageCounts.get(name) ?? 0) + 1);
  }
  const externalPackages = [...packageCounts.entries()]
    .sort(([a, x], [b, y]) => y - x || byString(a, b))
    .slice(0, MAX_EXTERNALS)
    .map(([name, importingFiles]) => ({ name, importingFiles }));

  const findings = runDiagramChecks({
    graph: result.graph,
    units,
    edges: allEdges,
    unitOfFile,
    unresolved: evidence.unresolved,
    oversizedUnitIds: built.oversizedUnitIds,
    scopeKind: options.scope.kind,
    isTest: isTestPath,
  });

  return {
    scope: options.scope,
    title: built.title,
    subtitle: built.subtitle,
    analysisId: result.id,
    analyzedAt: result.repoMeta.analysisTimestamp || result.createdAt,
    groups: [...built.groups].sort((a, b) => byString(a.id, b.id)),
    units,
    edges: kept.sort((a, b) => byString(a.id, b.id)),
    omitted: {
      edges: dropped.length,
      edgeMaxCount: dropped.reduce((max, edge) => Math.max(max, edge.count), 0),
      sharedEdges: sharedEdges.length,
      testFiles: built.hiddenTests,
      files: built.omittedFiles,
    },
    externalPackages,
    findings,
    partialEvidence: evidence.partial,
  };
}

export function buildDiagramModel(
  result: AnalysisResult,
  options: DiagramOptions,
  evidence: DiagramEvidence = evidenceFor(result),
): DiagramModel {
  const built = options.scope.kind === "repository"
    ? repositoryUnits(result, options)
    : regionUnits(result, options, options.scope.id, evidence);
  return finish(result, options, evidence, built);
}

function regionUnits(result: AnalysisResult, options: DiagramOptions, id: string, evidence: DiagramEvidence): Built {
  const cluster = result.clusters.find((candidate) => candidate.name === id);
  if (!cluster) throw new DiagramScopeError("The requested region is not part of this analysis.");
  const members = [...cluster.fileIds].sort(byString);
  const production = members.filter((path) => !isTestPath(path));
  // A test-only region is still worth drawing: hiding every file would draw nothing.
  const shown = options.includeTests || production.length === 0 ? members : production;
  const shownSet = new Set(shown);
  const memberSet = new Set(members);

  const degree = new Map<string, number>();
  for (const edge of result.graph.edges) {
    if (shownSet.has(edge.from)) degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    if (shownSet.has(edge.to)) degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const budget = BUDGETS[options.preset].files;
  const ranked = [...shown].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || byString(a, b));
  const visible = shown.length > budget ? ranked.slice(0, budget - 1) : ranked;
  const hidden = shown.length > budget ? ranked.slice(budget - 1) : [];

  // One level of sub-folder groups, relative to the region's own folder.
  const base = members.every((path) => path.startsWith(`${cluster.name}/`)) ? cluster.name : "";
  const subfolderOf = (path: string): string | null => {
    const rest = base ? path.slice(base.length + 1) : path;
    const segments = rest.split("/");
    return segments.length > 1 ? (base ? `${base}/${segments[0]}` : segments[0]) : null;
  };
  const subfolders = [...new Set(visible.map(subfolderOf).filter((sub): sub is string => sub !== null))].sort(byString);
  const useGroups = subfolders.length > 1;
  const groups: DiagramGroup[] = useGroups
    ? subfolders.map((sub) => ({
        id: `g:${sub}`, path: sub, label: base ? sub.slice(base.length + 1) : sub, parentId: null,
        files: visible.filter((path) => subfolderOf(path) === sub).length,
      }))
    : [];

  const drafts: Draft[] = visible.map((path) => {
    const sub = useGroups ? subfolderOf(path) : null;
    return {
      id: `f:${path}`, kind: "file", label: path.split("/").pop() ?? path, path,
      groupId: sub ? `g:${sub}` : null, depth: sub ? 1 : 0, files: [path], folder: null,
    };
  });
  if (hidden.length > 0) {
    drafts.push({
      id: "u:#overflow", kind: "overflow", label: `+ ${hidden.length} more files`, path: "",
      groupId: null, depth: 0, files: hidden, folder: null,
    });
  }

  const unitOfShown = new Map<string, string>();
  for (const draft of drafts) for (const file of draft.files) unitOfShown.set(file, draft.id);
  const folderOf = new Map(result.graph.nodes.map((node) => [node.path, node.folder]));
  const clusterSize = new Map(result.clusters.map((candidate) => [candidate.name, candidate.fileIds.length]));
  const extraEdges = new Map<string, { count: number; samples: string[] }>();
  const boundaries = new Map<string, Draft>();
  const addExtra = (from: string, to: string, sample: string | null, count = 1) => {
    const key = `${from}\0${to}`;
    const entry = extraEdges.get(key) ?? { count: 0, samples: [] };
    entry.count += count;
    if (sample) entry.samples.push(sample);
    extraEdges.set(key, entry);
  };
  const boundary = (neighbour: string, side: "in" | "out"): string => {
    const unitId = `b:${side}:${neighbour}`;
    if (!boundaries.has(unitId)) {
      boundaries.set(unitId, {
        id: unitId, kind: "boundary", label: neighbour, path: neighbour, groupId: null, depth: 0,
        files: [], folder: null, side, fileCount: clusterSize.get(neighbour) ?? 0,
      });
    }
    return unitId;
  };

  for (const edge of result.graph.edges) {
    const fromInside = memberSet.has(edge.from);
    const toInside = memberSet.has(edge.to);
    if (fromInside === toInside) continue;
    const insidePath = fromInside ? edge.from : edge.to;
    const insideUnit = unitOfShown.get(insidePath);
    if (!insideUnit) continue; // a hidden test file
    const neighbour = folderOf.get(fromInside ? edge.to : edge.from);
    if (!neighbour || neighbour === cluster.name) continue;
    if (fromInside) addExtra(insideUnit, boundary(neighbour, "out"), edge.id);
    else addExtra(boundary(neighbour, "in"), insideUnit, edge.id);
  }

  let unresolvedTotal = 0;
  for (const path of shown) {
    const count = evidence.unresolved.get(path) ?? 0;
    const unit = unitOfShown.get(path);
    if (count === 0 || !unit) continue;
    unresolvedTotal += count;
    addExtra(unit, "u:#unresolved", null, count);
  }
  if (unresolvedTotal > 0) {
    drafts.push({
      id: "u:#unresolved", kind: "unresolved", label: `${unresolvedTotal} unresolved imports`, path: "",
      groupId: null, depth: 0, files: [], folder: null, fileCount: 0,
    });
  }
  drafts.push(...[...boundaries.values()].sort((a, b) => byString(a.id, b.id)));

  const language = result.repoMeta.language ? ` · ${result.repoMeta.language}` : "";
  return {
    groups,
    drafts,
    extraEdges,
    omittedFiles: hidden.length,
    hiddenTests: members.length - shown.length,
    oversizedUnitIds: [],
    title: `${result.repoMeta.repoName} · ${cluster.name}`,
    subtitle: `Region detail · ${shown.length} files${language}`,
    includedFiles: shown,
  };
}
