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
import { composeOgCard, OG_WIDTH } from "./card";

/** Kept literal (not built with path.join) so file tracing can see the directory. */
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

/** A Slide-preset, light-theme, measured-only figure on the card, as PNG. */
export async function renderOgPng(result: AnalysisResult, origin: string): Promise<Uint8Array> {
  const options = { ...defaultDiagramOptions("slide"), annotations: "measured" as const };
  const figure = await renderDiagram(result, options, "svg", { origin, embedFonts: false });
  return rasterizeCard(composeOgCard(figure.body));
}
