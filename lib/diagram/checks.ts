/**
 * Measured structural findings: the figure's doubts and discrepancies,
 * computed without AI. Every rule reads only the dependency graph and the
 * aggregated diagram edges.
 *
 * @module lib/diagram/checks
 */
import type { DependencyGraph } from "@/types/graph";
import type { DiagramEdge, DiagramFinding, DiagramUnit, FindingKind } from "./types";

export type ChecksInput = Readonly<{
  graph: DependencyGraph;
  units: ReadonlyArray<DiagramUnit>;
  /** Every aggregated edge, before the edge budget. */
  edges: ReadonlyArray<DiagramEdge>;
  unitOfFile: ReadonlyMap<string, string>;
  unresolved: ReadonlyMap<string, number>;
  oversizedUnitIds: ReadonlyArray<string>;
  scopeKind: "repository" | "region";
  isTest: (path: string) => boolean;
}>;

const KIND_ORDER: ReadonlyArray<FindingKind> = ["cycle", "test-leak", "hub", "isolated", "misplaced", "unresolved-heavy", "oversized"];
const MAX_MISPLACED = 3;
const byString = (a: string, b: string) => a.localeCompare(b);

function listLabels(labels: string[]): string {
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Shared parts: imported by at least 3 other parts, and by at least 60% of
 * them. Returns the number of distinct importing parts for each. One rule for
 * the "hub" finding and for leaving fan-in arrows off the figure.
 */
export function sharedParts(
  units: ReadonlyArray<Pick<DiagramUnit, "id" | "kind">>,
  edges: ReadonlyArray<Pick<DiagramEdge, "from" | "to">>,
): Map<string, number> {
  const parts = units.filter((unit) => unit.kind === "folder" || unit.kind === "loose-files" || unit.kind === "file");
  const partIds = new Set(parts.map((unit) => unit.id));
  const shared = new Map<string, number>();
  if (parts.length < 4) return shared;
  const others = parts.length - 1;
  for (const unit of parts) {
    const importers = new Set(edges.filter((edge) => edge.to === unit.id && partIds.has(edge.from)).map((edge) => edge.from));
    if (importers.size >= 3 && importers.size / others >= 0.6) shared.set(unit.id, importers.size);
  }
  return shared;
}

export function runDiagramChecks(input: ChecksInput): DiagramFinding[] {
  const findings: DiagramFinding[] = [];
  const unitById = new Map(input.units.map((unit) => [unit.id, unit]));
  const label = (id: string) => unitById.get(id)?.label ?? id;
  const parts = input.units.filter((unit) => unit.kind === "folder" || unit.kind === "loose-files" || unit.kind === "file");

  // cycle — groups of units that import each other.
  const cyclic = input.units.filter((unit) => unit.inCycle);
  const cycleEdges = input.edges.filter((edge) => edge.inCycle);
  const componentOf = new Map<string, string>();
  for (const unit of cyclic) componentOf.set(unit.id, unit.id);
  const find = (id: string): string => (componentOf.get(id) === id ? id : find(componentOf.get(id)!));
  for (const edge of cycleEdges) {
    const [a, b] = [find(edge.from), find(edge.to)].sort(byString);
    if (a !== b) componentOf.set(b, a);
  }
  const components = new Map<string, string[]>();
  for (const unit of cyclic) components.set(find(unit.id), [...(components.get(find(unit.id)) ?? []), unit.id]);
  for (const members of components.values()) {
    const subjects = [...members].sort(byString);
    findings.push({
      id: `cycle:${subjects.join(",")}`,
      kind: "cycle",
      confidence: "derived",
      subjects,
      figures: { parts: subjects.length },
      text: subjects.length === 2
        ? `${listLabels(subjects.map(label))} import each other.`
        : `${listLabels(subjects.map(label))} import each other in a loop.`,
    });
  }

  // test-leak — production files importing test files (evaluated on the whole graph).
  const leaks = input.graph.edges.filter((edge) => !input.isTest(edge.from) && input.isTest(edge.to));
  if (leaks.length > 0) {
    const first = [...leaks].sort((a, b) => byString(a.id, b.id))[0];
    const subjects = [...new Set(leaks.map((edge) => input.unitOfFile.get(edge.from)).filter((id): id is string => Boolean(id)))].sort(byString);
    findings.push({
      id: `test-leak:${subjects.join(",")}`,
      kind: "test-leak",
      confidence: "derived",
      subjects,
      figures: { imports: leaks.length },
      text: `${leaks.length} import${leaks.length === 1 ? " goes" : "s go"} from production code into test code (for example ${first.from} imports ${first.to}).`,
    });
  }

  // hub — imported by at least 60% of the other parts, and at least 3 (see sharedParts).
  for (const [id, importers] of sharedParts(input.units, input.edges)) {
    const others = parts.length - 1;
    findings.push({
      id: `hub:${id}`,
      kind: "hub",
      confidence: "derived",
      subjects: [id],
      figures: { importers, of: others },
      text: `${label(id)} is imported by ${importers} of the ${others} other parts.`,
    });
  }

  // isolated — a non-test part with no arrows at all.
  if (parts.length > 1) {
    for (const unit of parts) {
      const touched = input.edges.some((edge) => edge.from === unit.id || edge.to === unit.id);
      if (!touched && unit.testFiles < unit.files) {
        findings.push({
          id: `isolated:${unit.id}`,
          kind: "isolated",
          confidence: "derived",
          subjects: [unit.id],
          figures: {},
          text: `${unit.label} neither imports nor is imported by any other part shown.`,
        });
      }
    }
  }

  // misplaced — repository scope only: a file with 3+ connections, none inside
  // its own unit, and at least 80% of them with one other unit.
  if (input.scopeKind === "repository") {
    const candidates: { path: string; own: string; other: string; total: number; share: number }[] = [];
    const byFile = new Map<string, { own: number; total: number; others: Map<string, number> }>();
    for (const edge of input.graph.edges) {
      for (const [path, otherPath] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
        const own = input.unitOfFile.get(path);
        const other = input.unitOfFile.get(otherPath);
        if (!own || !other || path === otherPath) continue;
        const entry = byFile.get(path) ?? { own: 0, total: 0, others: new Map<string, number>() };
        entry.total += 1;
        if (other === own) entry.own += 1;
        else entry.others.set(other, (entry.others.get(other) ?? 0) + 1);
        byFile.set(path, entry);
      }
    }
    for (const [path, entry] of byFile) {
      if (entry.total < 3 || entry.own > 0) continue;
      const [other, count] = [...entry.others.entries()].sort(([a, x], [b, y]) => y - x || byString(a, b))[0];
      if (count / entry.total < 0.8) continue;
      candidates.push({ path, own: input.unitOfFile.get(path)!, other, total: entry.total, share: count });
    }
    candidates.sort((a, b) => b.total - a.total || byString(a.path, b.path));
    for (const candidate of candidates.slice(0, MAX_MISPLACED)) {
      const share = candidate.share === candidate.total ? `all ${candidate.total}` : `${candidate.share} of ${candidate.total}`;
      findings.push({
        id: `misplaced:${candidate.path}`,
        kind: "misplaced",
        confidence: "heuristic",
        subjects: [candidate.own, candidate.other],
        figures: { connections: candidate.total, withOther: candidate.share },
        text: `${candidate.path} connects only outside ${label(candidate.own)}: ${share} of its connections involve ${label(candidate.other)}.`,
      });
    }
  }

  // unresolved-heavy — more than 10% (and at least 3) of a unit's imports do not resolve.
  for (const unit of parts) {
    let unresolved = 0;
    let resolved = 0;
    for (const [path, unitId] of input.unitOfFile) {
      if (unitId !== unit.id) continue;
      unresolved += input.unresolved.get(path) ?? 0;
    }
    for (const edge of input.graph.edges) if (input.unitOfFile.get(edge.from) === unit.id) resolved += 1;
    const total = unresolved + resolved;
    if (unresolved >= 3 && unresolved / total > 0.1) {
      findings.push({
        id: `unresolved-heavy:${unit.id}`,
        kind: "unresolved-heavy",
        confidence: "derived",
        subjects: [unit.id],
        figures: { unresolved, of: total },
        text: `${unresolved} of ${total} imports in ${unit.label} do not resolve to a file in the repository.`,
      });
    }
  }

  // oversized — a large folder with no sub-folders to split it along.
  for (const id of input.oversizedUnitIds) {
    const unit = unitById.get(id);
    if (!unit) continue;
    findings.push({
      id: `oversized:${id}`,
      kind: "oversized",
      confidence: "derived",
      subjects: [id],
      figures: { files: unit.files },
      text: `${unit.label} holds ${unit.files} files with no sub-folders to divide them.`,
    });
  }

  return findings.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byString(a.id, b.id));
}
