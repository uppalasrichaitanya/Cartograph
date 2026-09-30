/**
 * Rasterizes the link-preview card with resvg.
 *
 * resvg ignores @font-face and cannot read WOFF/WOFF2, so the IBM Plex faces
 * ship as TTF in lib/og/fonts (SIL OFL) and system fonts are switched off:
 * the PNG is the same on Windows, macOS and Vercel's Linux.
 *
 * @module lib/og/render
 */
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { renderDiagram } from "@/lib/diagram";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import type { AnalysisResult } from "@/types/graph";
import { buildDiagramModel } from "@/lib/diagram/model";
import { composeOgCard, composeSummaryCard, OG_WIDTH, usesSummaryCard } from "./card";

/** Must also be listed in next.config.ts outputFileTracingIncludes for /api/og/** (a test checks), or Vercel will not ship them. */
export const OG_FONT_FILES = [
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-SemiBold.ttf",
  "IBMPlexSans-SemiBold.ttf",
];

export function rasterizeCard(cardSvg: string): Uint8Array {
  const fontDir = path.join(process.cwd(), "lib", "og", "fonts");
  const resvg = new Resvg(cardSvg, {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: {
      fontFiles: OG_FONT_FILES.map((file) => path.join(fontDir, file)),
      loadSystemFonts: false,
      defaultFontFamily: "IBM Plex Sans",
    },
  });
  return resvg.render().asPng();
}

/**
 * A Slide-preset, light-theme, measured-only figure on the card, as PNG. A
 * repository with fewer than three units gets a summary card instead (name,
 * stats, tagline), with the small figure below when it stays legible.
 * Keep annotations "measured": AI captions need Plex Sans italic, which is not bundled.
 */
export async function renderOgPng(result: AnalysisResult, origin: string): Promise<Uint8Array> {
  const measured = { annotations: "measured" as const };
  const context = { origin, embedFonts: false };
  const slide = { ...defaultDiagramOptions("slide"), ...measured };
  if (usesSummaryCard(buildDiagramModel(result, slide).units.length)) {
    const meta = result.repoMeta;
    // The slide canvas is a fixed 1920x1080, mostly empty for one or two boxes;
    // the document preset hugs its content, so it stays large enough to read.
    const compact = await renderDiagram(result, { ...defaultDiagramOptions("document"), ...measured }, "svg", context);
    return rasterizeCard(composeSummaryCard(
      { repoName: meta.repoName, files: meta.fileCount, imports: meta.dependencyCount, language: meta.language ?? "" },
      compact.body,
    ));
  }
  const figure = await renderDiagram(result, slide, "svg", context);
  return rasterizeCard(composeOgCard(figure.body));
}
