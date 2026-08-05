/**
 * Confidence Projection — IR Provenance → Render Layer
 *
 * The IR records, per file, how much evidence stands behind what Cartograph
 * knows about it. The render layer needs that same judgement keyed by file
 * path, because RenderData is path-keyed while the IR is NodeId-keyed.
 *
 * This module is the single place that translation happens. It computes
 * nothing new: every value it returns is already present in the IR, and the
 * fallback path reproduces the IR builder's own rule rather than inventing
 * a different one.
 *
 * Why a fallback exists at all: buildRepositoryIR returns null when IR
 * construction fails, which indicates a builder or parser bug rather than
 * anything wrong with the user's repository. Rendering every node as
 * `unknown` in that case would be a false statement — the structure was
 * observed, only the provenance record was lost. So the fallback derives
 * confidence from the legacy parseErrors list using the same test the
 * builder applies (errors present → heuristic, otherwise verified).
 *
 * @module lib/analysis/projectConfidence
 */

import type { RepositoryIR, FileNode, IRParseError } from "./ir/types";
import type { GeometryConfidence, ParseError } from "@/types/graph";

/**
 * Map from file path (as used by the legacy graph and RenderData) to the
 * confidence Cartograph has in that file's extracted facts.
 */
export type ConfidenceByPath = ReadonlyMap<string, GeometryConfidence>;

/**
 * Project per-file confidence from a validated RepositoryIR.
 *
 * FileNode.confidence is 'precise' | 'heuristic'. The projection is direct:
 *   precise   → 'verified'  (facts were observed without incident)
 *   heuristic → 'heuristic' (facts were salvaged from a failed parse)
 *
 * Note this reads FileNode.confidence rather than FileNode.provenance.origin.
 * The two agree today, but confidence is the field the IR documents as
 * describing extraction quality, and it is the narrower, more specific claim.
 */
function fromIR(ir: RepositoryIR): ConfidenceByPath {
  const byPath = new Map<string, GeometryConfidence>();
  for (const node of ir.nodes) {
    if (node.kind !== "File") continue;
    const file = node as FileNode;
    byPath.set(
      file.path,
      file.confidence === "heuristic" ? "heuristic" : "verified",
    );
  }
  return byPath;
}

/**
 * Fallback projection for when no IR is available.
 *
 * Reproduces IRBuilder.buildFileNode's rule: a file with any recorded parse
 * error yielded salvaged data and is therefore heuristic; everything else was
 * extracted cleanly and is verified.
 */
function fromParseErrors(
  filePaths: ReadonlyArray<string>,
  parseErrors: ReadonlyArray<ParseError>,
): ConfidenceByPath {
  const failed = new Set(parseErrors.map((error) => error.filePath));
  const byPath = new Map<string, GeometryConfidence>();
  for (const filePath of filePaths) {
    byPath.set(filePath, failed.has(filePath) ? "heuristic" : "verified");
  }
  return byPath;
}

/**
 * Build the path → confidence map used to stamp render nodes and edges.
 *
 * Prefers the IR. Falls back to parseErrors only when IR construction failed.
 *
 * @param ir         - The validated IR, or null/undefined if it failed to build
 * @param filePaths  - Every file path present in the legacy graph
 * @param parseErrors- Legacy parse errors, used only by the fallback path
 */
export function projectConfidenceByPath(
  ir: RepositoryIR | null | undefined,
  filePaths: ReadonlyArray<string>,
  parseErrors: ReadonlyArray<ParseError>,
): ConfidenceByPath {
  if (ir) return fromIR(ir);
  return fromParseErrors(filePaths, parseErrors);
}

/**
 * Confidence for an edge, given the confidence of the file it originates from.
 *
 * This mirrors the IR's provenance propagation rule (IRBuilder
 * .buildDependencyEdges): an import edge is a deterministic consequence of
 * its source file's extracted facts, so it is 'derived' — unless the source
 * file's own facts were salvaged, in which case the edge inherits 'heuristic'
 * and never upgrades.
 *
 * Edges terminating at an unresolved import are 'unknown' and are built
 * directly by collectUnresolvedImports rather than through this function.
 */
export function edgeConfidenceFromSource(
  sourceConfidence: GeometryConfidence | undefined,
): GeometryConfidence {
  return sourceConfidence === "heuristic" ? "heuristic" : "derived";
}

/**
 * An import whose target could not be determined, paired with the file that
 * referenced it.
 */
export type UnresolvedImportRef = {
  /** Path of the file containing the specifier. */
  readonly fromPath: string;
  /** Raw specifier exactly as written in source. */
  readonly specifier: string;
};

/**
 * Collect every unresolved import in the IR, grouped by referencing file.
 *
 * Walks import edges whose target is an UnresolvedImportNode. Nothing is
 * inferred: the IR already recorded these during construction, and this only
 * re-keys them by file path so the path-keyed render layer can place them.
 *
 * Returns an empty map when there is no IR — the honest answer, since without
 * the IR we have no record of which imports failed to resolve. Note this is
 * NOT the same as asserting there are none; consumers should not present an
 * empty result as "everything resolved".
 */
export function collectUnresolvedImports(
  ir: RepositoryIR | null | undefined,
): ReadonlyMap<string, ReadonlyArray<UnresolvedImportRef>> {
  const byFile = new Map<string, UnresolvedImportRef[]>();
  if (!ir) return byFile;

  const filePathById = new Map<string, string>();
  const specifierById = new Map<string, string>();
  for (const node of ir.nodes) {
    if (node.kind === "File") {
      filePathById.set(node.id, node.path);
    } else if (node.kind === "UnresolvedImport") {
      specifierById.set(node.id, node.specifier);
    }
  }

  for (const edge of ir.edges) {
    if (edge.kind !== "imports") continue;
    const specifier = specifierById.get(edge.to);
    if (specifier === undefined) continue;
    const fromPath = filePathById.get(edge.from);
    if (fromPath === undefined) continue;

    const existing = byFile.get(fromPath);
    const ref: UnresolvedImportRef = { fromPath, specifier };
    if (existing) existing.push(ref);
    else byFile.set(fromPath, [ref]);
  }

  // Stable ordering so layout stays deterministic across runs.
  for (const refs of byFile.values()) {
    refs.sort((a, b) => a.specifier.localeCompare(b.specifier));
  }
  return byFile;
}

/**
 * Why a file's confidence is reduced, and what could not be determined.
 *
 * Assembled for the inspector. Every field is read from the IR; none is
 * computed. `null` means the IR had nothing to say — which for a verified
 * file is the expected, correct answer.
 */
export type FileEvidence = {
  readonly confidence: GeometryConfidence;
  /**
   * Plain-language causes of reduced confidence, one per parse error.
   * Empty when the file parsed cleanly.
   */
  readonly reducedBecause: ReadonlyArray<string>;
  /** Specifiers whose targets could not be determined. */
  readonly unresolvedImports: ReadonlyArray<string>;
  /**
   * Number of facts this file's provenance was computed from, when the IR
   * records lineage. Present only for derived provenance.
   */
  readonly derivedFromCount?: number;
};

/**
 * Translate an IRParseError into a plain-language cause.
 *
 * Wording states what happened without assigning blame: these are facts about
 * what the analysis could observe, not faults in the code. A file that timed
 * out is not a bad file, and saying so in alarming language would spend
 * attention that belongs on understanding the repository.
 */
function describeParseError(error: IRParseError): string {
  const scope =
    error.severity === "fatal"
      ? "No imports could be read from this file"
      : "Some imports may be missing";
  switch (error.reason) {
    case "syntax":
      return `${scope} — the file has a syntax error.`;
    case "timeout":
      return `${scope} — the file took too long to analyse.`;
    case "unreadable":
      return `${scope} — the file could not be read as source text.`;
    default:
      return `${scope} — the file could not be fully analysed.`;
  }
}

/**
 * Assemble the evidence behind one file, for display in the inspector.
 *
 * Returns null when there is no IR, so callers can distinguish "no evidence
 * record available" from "evidence record says everything is fine".
 */
export function fileEvidence(
  ir: RepositoryIR | null | undefined,
  filePath: string,
): FileEvidence | null {
  if (!ir) return null;

  const file = ir.nodes.find(
    (node): node is FileNode => node.kind === "File" && node.path === filePath,
  );
  if (!file) return null;

  const unresolved = collectUnresolvedImports(ir).get(filePath) ?? [];

  return {
    confidence: file.confidence === "heuristic" ? "heuristic" : "verified",
    reducedBecause: file.parseErrors.map(describeParseError),
    unresolvedImports: unresolved.map((ref) => ref.specifier),
    ...(file.provenance.derivedFrom
      ? { derivedFromCount: file.provenance.derivedFrom.length }
      : {}),
  };
}
