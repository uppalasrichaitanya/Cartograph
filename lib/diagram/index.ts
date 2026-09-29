/**
 * Public entry point: an analysis and options in, a finished file out.
 *
 * @module lib/diagram
 */
import type { AnalysisResult } from "@/types/graph";
import { layoutDiagram } from "./layout";
import { renderMermaid } from "./mermaid";
import { buildDiagramModel } from "./model";
import { diagramFilename } from "./options";
import { renderSvg } from "./svg";
import type { DiagramFormat, DiagramModel, DiagramNote, DiagramOptions, DiagramReviewAnnotations } from "./types";

export { DiagramScopeError } from "./model";
export { DiagramOptionsError, parseDiagramOptions } from "./options";

export function measuredNotes(model: DiagramModel): DiagramNote[] {
  return model.findings.map((finding) => ({ text: finding.text, subjects: finding.subjects, source: "measured" as const }));
}

export type RenderedDiagram = Readonly<{
  body: string;
  contentType: string;
  filename: string;
  scale: number | null;
  reviewMissing: boolean;
}>;

export async function renderDiagram(
  result: AnalysisResult,
  options: DiagramOptions,
  format: DiagramFormat,
  context: Readonly<{ origin: string; review?: DiagramReviewAnnotations | null; embedFonts?: boolean }>,
): Promise<RenderedDiagram> {
  const model = buildDiagramModel(result, options);
  if (format === "mermaid") {
    return {
      body: renderMermaid(model, context.origin),
      contentType: "text/plain; charset=utf-8",
      filename: diagramFilename(result.repoMeta.repoName, "mmd"),
      scale: null,
      reviewMissing: false,
    };
  }
  const wantsAi = options.annotations === "measured+ai";
  const review = wantsAi ? context.review ?? null : null;
  const positioned = await layoutDiagram(model, options);
  const rendered = renderSvg({
    positioned,
    options,
    origin: context.origin,
    embedFonts: context.embedFonts,
    annotations: {
      captions: review?.captions ?? new Map(),
      notes: [...measuredNotes(model), ...(review?.notes ?? [])],
    },
  });
  return {
    body: rendered.svg,
    contentType: "image/svg+xml; charset=utf-8",
    filename: diagramFilename(result.repoMeta.repoName, "svg"),
    scale: rendered.scale,
    reviewMissing: wantsAi && review === null,
  };
}
