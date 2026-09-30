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

/** A card with fewer units than this has too little diagram to fill 1200x630. */
const SUMMARY_BELOW_UNITS = 3;

export function usesSummaryCard(unitCount: number): boolean {
  return unitCount < SUMMARY_BELOW_UNITS;
}

export type SummaryCardInput = Readonly<{ repoName: string; files: number; imports: number; language: string }>;

const esc = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Keep only characters the bundled Latin faces can draw. */
const latin = (value: string) => [...value]
  .map((char) => {
    const code = char.codePointAt(0)!;
    return (code >= 0x20 && code <= 0xff) || (code >= 0x2000 && code <= 0x206f) ? char : "?";
  })
  .join("");

const text = (value: string) => esc(latin(value));

const MARGIN = 72;
const NAME_MAX_WIDTH = OG_WIDTH - 2 * MARGIN;
const NAME_SIZES = [88, 72, 60, 48];
/** Plex Sans SemiBold averages a little under 0.58 em per character; err wide so nothing clips. */
const NAME_ADVANCE = 0.58;
const FIGURE_BAND = { x: MARGIN, y: 396, width: OG_WIDTH - 2 * MARGIN, height: 190 };
/** Below this scale the figure's own text is too small to read on a card. */
const MIN_FIGURE_SCALE = 0.7;
/** With no figure below, the text block moves down to sit in the middle of the card. */
const CENTRED_SHIFT = 80;

/** The repo name at the largest size that fits, ellipsised when even the smallest does not. */
function fitName(name: string): { text: string; size: number } {
  const chars = [...latin(name)];
  for (const size of NAME_SIZES) {
    if (chars.length * size * NAME_ADVANCE <= NAME_MAX_WIDTH) return { text: name, size };
  }
  const size = NAME_SIZES[NAME_SIZES.length - 1];
  const max = Math.max(1, Math.floor(NAME_MAX_WIDTH / (size * NAME_ADVANCE)));
  return { text: `${chars.slice(0, max - 1).join("")}…`, size };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The card for a repository too small to draw as a figure: wordmark, repo
 * name, a stats line and the tagline, with the figure (if any) scaled into the
 * lower band when it stays legible. Pure; returns an SVG string.
 */
export function composeSummaryCard(input: SummaryCardInput, figureSvg: string | null): string {
  const theme = THEMES.light;
  const name = fitName(input.repoName);
  const stats = [plural(input.files, "file"), plural(input.imports, "import"), input.language]
    .filter(Boolean)
    .join(" · ");
  const mono = (weight: number) => `font-family="IBM Plex Mono" font-weight="${weight}"`;
  // Decide the figure first: whether it fits changes where the text sits.
  const root = figureSvg ? ROOT.exec(figureSvg) : null;
  let figure: string | null = null;
  if (figureSvg && root) {
    const { width, height } = figureSize(root[1]);
    const scale = Math.min(FIGURE_BAND.width / width, FIGURE_BAND.height / height);
    if (scale >= MIN_FIGURE_SCALE) {
      const w = width * scale;
      const h = height * scale;
      const x = round(FIGURE_BAND.x + (FIGURE_BAND.width - w) / 2);
      const y = round(FIGURE_BAND.y + (FIGURE_BAND.height - h) / 2);
      const attrs = root[1].replace(/\s(?:width|height|viewBox|x|y)="[^"]*"/g, "");
      figure = `<svg${attrs} x="${x}" y="${y}" width="${round(w)}" height="${round(h)}" viewBox="0 0 ${width} ${height}">${figureSvg.slice(root[0].length)}`;
    }
  }
  const dy = figure ? 0 : CENTRED_SHIFT;
  const parts = [
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${theme.ground}"/>`,
    `<rect x="${MARGIN}" y="${72 + dy}" width="28" height="4" fill="${theme.accent}"/>`,
    `<text x="${MARGIN}" y="${112 + dy}" ${mono(600)} font-size="24" letter-spacing="4" fill="${theme.ink}">CARTOGRAPH</text>`,
    `<text x="${MARGIN}" y="${(name.size > 60 ? 236 : 226) + dy}" font-family="IBM Plex Sans" font-weight="600" font-size="${name.size}" fill="${theme.ink}">${text(name.text)}</text>`,
    `<text x="${MARGIN}" y="${298 + dy}" ${mono(400)} font-size="30" fill="${theme.inkMuted}">${text(stats)}</text>`,
    `<text x="${MARGIN}" y="${352 + dy}" ${mono(400)} font-size="24" fill="${theme.inkFaint}">Every edge is read from an import statement.</text>`,
  ];
  if (figure) {
    parts.push(`<line x1="${MARGIN}" y1="${FIGURE_BAND.y - 20}" x2="${OG_WIDTH - MARGIN}" y2="${FIGURE_BAND.y - 20}" stroke="${theme.rule}" stroke-width="1"/>`, figure);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">${parts.join("")}</svg>`;
}
