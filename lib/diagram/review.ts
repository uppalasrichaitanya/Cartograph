/**
 * AI review of a diagram: role captions for boxes, and plain-language notes
 * on the architecture's doubts and discrepancies.
 *
 * The model interprets the measured figure; it never authors it. Evidence is
 * bounded, every point must cite a unit or edge on this figure, figures not
 * in the evidence are removed, and results are cached per figure so a review
 * costs one provider call.
 *
 * @module lib/diagram/review
 */
import { createHash } from "node:crypto";
import { dropUnsupportedFigures, evidenceNumbers, validateCitation } from "@/lib/ai/grounding";
import type { AiEvidenceCatalog, AiResponse, GroundedClaim } from "@/lib/ai/types";
import type { AnalysisResult } from "@/types/graph";
import type { DiagramModel, DiagramNote, DiagramReviewAnnotations } from "./types";

export const REVIEW_PROMPT_VERSION = 2;

const LIMITS = { units: 26, edges: 40, keyFiles: 3, declarations: 6, captionChars: 48, noteChars: 240, notes: 6 } as const;

export type ReviewPrompt = Readonly<{
  prompt: string;
  allowed: AiEvidenceCatalog;
  figures: ReadonlySet<string>;
  unitIds: ReadonlySet<string>;
}>;

export type StoredReview = Readonly<{
  answer: string;
  claims: ReadonlyArray<GroundedClaim>;
  uncertainty?: string;
  dropped: number;
  provider: string;
  model: string;
  generatedAt: string;
}>;

export function isStoredReview(value: unknown): value is StoredReview {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.answer === "string" && Array.isArray(candidate.claims);
}

function unitFiles(model: DiagramModel, result: AnalysisResult): Map<string, string[]> {
  // Recompute membership from paths: repository units are folders (`u:<path>`),
  // loose files (`u:<path>#files`), or files (`f:<path>`).
  const byUnit = new Map<string, string[]>();
  const units = model.units;
  for (const node of result.graph.nodes) {
    const owner = units.find((unit) =>
      unit.id === `f:${node.path}`
      || (unit.kind === "folder" && node.path.startsWith(`${unit.path}/`)
        && !units.some((other) => other.kind === "folder" && other.path.length > unit.path.length && node.path.startsWith(`${other.path}/`))));
    if (owner) byUnit.set(owner.id, [...(byUnit.get(owner.id) ?? []), node.path]);
  }
  return byUnit;
}

export function buildReviewPrompt(model: DiagramModel, result: AnalysisResult): ReviewPrompt {
  const inDegree = new Map<string, number>();
  for (const edge of result.graph.edges) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  const declarations = new Map<string, string[]>();
  for (const node of result.repositoryIR?.nodes ?? []) {
    if (node.kind === "File" && node.declarations?.length) declarations.set(node.path, node.declarations.map((declaration) => declaration.name));
  }
  const files = unitFiles(model, result);
  const units = model.units.slice(0, LIMITS.units).map((unit) => {
    const members = files.get(unit.id) ?? [];
    const keyFiles = [...members]
      .sort((a, b) => (inDegree.get(b) ?? 0) - (inDegree.get(a) ?? 0) || a.localeCompare(b))
      .slice(0, LIMITS.keyFiles);
    const declares = keyFiles.flatMap((path) => declarations.get(path) ?? []).slice(0, LIMITS.declarations);
    return {
      id: unit.id,
      label: unit.label,
      kind: unit.kind,
      files: unit.files,
      lines: unit.lines,
      ...(unit.sharedBy ? { importedByUnits: unit.sharedBy } : {}),
      ...(keyFiles.length ? { keyFiles } : {}),
      ...(declares.length ? { declares } : {}),
    };
  });
  const edges = model.edges.slice(0, LIMITS.edges).map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    imports: edge.count,
    ...(edge.mutual ? { mutual: true } : {}),
  }));
  const evidence = {
    repository: result.repoMeta.repoName,
    language: result.repoMeta.language,
    framework: result.repoMeta.framework,
    diagram: model.subtitle,
    units,
    edges,
    measuredFindings: model.findings.map((finding) => ({ id: finding.id, kind: finding.kind, confidence: finding.confidence, text: finding.text, subjects: finding.subjects })),
    externalPackages: model.externalPackages,
  };
  const unitIds = new Set(units.map((unit) => unit.id));
  const allowed: AiEvidenceCatalog = {
    nodeIds: new Set(),
    edgeIds: new Set(edges.map((edge) => edge.id)),
    analyzerResultIds: new Set(),
    regionIds: unitIds,
  };
  return {
    allowed,
    unitIds,
    figures: evidenceNumbers(evidence),
    prompt: [
      "Review this architecture diagram. Cartograph built it from static import analysis: each unit is a box (a folder, a group of files, or a file) and each edge aggregates file-level imports between two units.",
      "",
      "Tasks:",
      `1. For each unit, one caption: its likely role in at most 6 words (at most ${LIMITS.captionChars} characters), no numbers, no trailing period.`,
      `2. Up to ${LIMITS.notes} notes on doubts or discrepancies a reviewer should look at. Good notes explain a measured finding in plain terms, point out where names and dependencies disagree (for example a "utils" folder that imports UI code), or ask a question the structure raises. Each note at most ${LIMITS.noteChars} characters.`,
      "",
      "Rules:",
      "- Plain text, no Markdown. Phrase inferences as inferences (\"likely\", \"appears to\").",
      "- Only state figures that appear in the evidence.",
      "- Cite with kind \"region\" for a unit id and kind \"edge\" for an edge id. A caption cites exactly its own unit. A note cites every unit or edge it is about.",
      "- The diagram is measured and fixed: never suggest moving, merging, or renaming boxes; talk about the code.",
      "",
      "Return exactly one JSON object:",
      '{"summary":"1-2 sentences: what this system appears to be and how it is organised","claims":[{"section":"caption","text":"...","citations":[{"kind":"region","id":"unit id"}]},{"section":"note","text":"...","citations":[{"kind":"region|edge","id":"..."}]}],"uncertainty":"optional"}',
      `Allowed citation IDs: ${JSON.stringify({ region: [...unitIds], edge: edges.map((edge) => edge.id) })}`,
      `Evidence: ${JSON.stringify(evidence)}`,
    ].join("\n"),
  };
}

export function finalizeReview(response: AiResponse, prompt: ReviewPrompt): { response: AiResponse; dropped: number } {
  const cited = response.claims.filter((claim) =>
    claim.text && claim.citations.length > 0 && claim.citations.every((citation) => validateCitation(citation, prompt.allowed)));

  const captioned = new Set<string>();
  const captions: GroundedClaim[] = [];
  for (const claim of cited.filter((item) => item.section === "caption")) {
    const text = claim.text.trim().replace(/\.+$/, "");
    const [citation] = claim.citations;
    if (claim.citations.length !== 1 || citation.kind !== "region" || captioned.has(citation.id)) continue;
    if (!text || [...text].length > LIMITS.captionChars || /\d/.test(text)) continue;
    captioned.add(citation.id);
    captions.push({ section: "caption", text, citations: [citation] });
  }

  const candidateNotes = cited
    .filter((item) => item.section === "note" && [...item.text].length <= LIMITS.noteChars)
    .map((item) => ({ ...item, section: "note" }));
  const checked = dropUnsupportedFigures({ answer: response.answer, claims: candidateNotes }, prompt.figures);
  const notes = checked.response.claims.slice(0, LIMITS.notes);

  if (captions.length === 0 && notes.length === 0) throw new Error("No caption or note in the review was grounded in the diagram.");
  const kept = [...captions, ...notes];
  return {
    response: {
      answer: checked.response.answer,
      claims: kept,
      ...(response.uncertainty ? { uncertainty: response.uncertainty } : {}),
    },
    dropped: response.claims.length - kept.length,
  };
}

export function reviewCacheKey(model: DiagramModel): string {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    // Notes may quote a unit's file or line count, so those belong to the figure's identity.
    units: model.units.map((unit) => `${unit.id}:${unit.files}:${unit.lines}:${unit.sharedBy ?? 0}`),
    edges: model.edges.map((edge) => `${edge.id}:${edge.count}`),
    findings: model.findings.map((finding) => finding.id),
  })).digest("hex");
  return createHash("sha256").update(`diagram-review\0v${REVIEW_PROMPT_VERSION}\0${fingerprint}`).digest("hex");
}

export function reviewAnnotations(review: StoredReview, model: DiagramModel): DiagramReviewAnnotations {
  const onFigure = new Set([...model.units.map((unit) => unit.id), ...model.edges.map((edge) => edge.id)]);
  const captions = new Map<string, string>();
  const notes: DiagramNote[] = [];
  for (const claim of review.claims) {
    const subjects = claim.citations.map((citation) => citation.id).filter((id) => onFigure.has(id));
    if (subjects.length === 0) continue;
    if (claim.section === "caption" && !captions.has(subjects[0])) captions.set(subjects[0], claim.text);
    if (claim.section === "note") notes.push({ text: claim.text, subjects, source: "ai" });
  }
  return { captions, notes };
}
