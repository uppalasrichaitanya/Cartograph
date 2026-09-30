/**
 * Link-preview card: the Slide-preset figure letterboxed onto a 1200x630
 * canvas in the light theme's paper colour. Pure; returns an SVG string.
 *
 * @module lib/og/card
 */
import { THEMES } from "@/lib/diagram/theme";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const ROOT = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b([^>]*)>/;

function attr(attrs: string, name: string): string | null {
  return new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
}

/** The figure's own coordinate space, from its viewBox (or width and height). */
function figureSize(attrs: string): { width: number; height: number } {
  const box = attr(attrs, "viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = box?.length === 4 ? box[2] : Number(attr(attrs, "width"));
  const height = box?.length === 4 ? box[3] : Number(attr(attrs, "height"));
  if (!(width > 0) || !(height > 0)) throw new Error("The figure has no usable size.");
  return { width, height };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function composeOgCard(figureSvg: string): string {
  const root = ROOT.exec(figureSvg);
  if (!root) throw new Error("The figure is not an SVG document.");
  const { width, height } = figureSize(root[1]);
  const scale = Math.min(OG_WIDTH / width, OG_HEIGHT / height);
  const fitWidth = width * scale;
  const fitHeight = height * scale;
  const x = round((OG_WIDTH - fitWidth) / 2);
  const y = round((OG_HEIGHT - fitHeight) / 2);
  // Replace the root's own sizing so the nested viewport, not the figure, decides the scale.
  const attrs = root[1].replace(/\s(?:width|height|viewBox|x|y)="[^"]*"/g, "");
  const nested = `<svg${attrs} x="${x}" y="${y}" width="${round(fitWidth)}" height="${round(fitHeight)}" viewBox="0 0 ${width} ${height}">`;
  const inner = figureSvg.slice(root[0].length);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`
    + `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${THEMES.light.ground}"/>${nested}${inner}</svg>`;
}
