/**
 * Sizes, budgets and text measurement for presentation diagrams.
 *
 * Layout runs on the server, where there is no canvas to measure text. Box
 * labels are therefore set in IBM Plex Mono, whose advance is exactly 0.6 em,
 * so widths are exact. The only proportional text (the title) is estimated
 * conservatively and has the whole canvas width to itself.
 *
 * @module lib/diagram/metrics
 */
import type { DiagramPreset, DiagramUnit } from "./types";

export const BUDGETS = {
  document: { units: 24, files: 32, edges: 40, notes: 6 },
  slide: { units: 16, files: 20, edges: 26, notes: 3 },
} as const satisfies Record<DiagramPreset, { units: number; files: number; edges: number; notes: number }>;

export const TYPE_SCALE = {
  document: { eyebrow: 11, title: 34, subtitle: 14, groupTitle: 11, unitLabel: 15, unitMeta: 12, caption: 12, edgeLabel: 12, footer: 11 },
  slide: { eyebrow: 13, title: 44, subtitle: 17, groupTitle: 13, unitLabel: 19, unitMeta: 15, caption: 15, edgeLabel: 14, footer: 13 },
} as const;

export const DOCUMENT_CANVAS = { minWidth: 1600, maxWidth: 2400, minHeight: 900, margin: 56 } as const;
export const SLIDE_CANVAS = { width: 1920, height: 1080, margin: 72, maxScale: 1.5, warnBelow: 0.6 } as const;

export const UNIT_WIDTH = {
  document: { min: 150, max: 300 },
  slide: { min: 180, max: 340 },
} as const;

const PAD_X = 16;
const PAD_TOP = 12;
const PAD_BOTTOM = 10;
const BAR = 3;
const MONO_ADVANCE = 0.6;
const SANS_ADVANCE = 0.58;

const chars = (text: string) => [...text];

export function monoWidth(text: string, size: number): number {
  return chars(text).length * size * MONO_ADVANCE;
}

export function sansWidth(text: string, size: number): number {
  return chars(text).length * size * SANS_ADVANCE;
}

export function monoChars(width: number, size: number): number {
  return Math.max(1, Math.floor(width / (size * MONO_ADVANCE)));
}

export function truncateMiddle(text: string, maxChars: number): string {
  const all = chars(text);
  if (all.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${all.slice(0, head).join("")}…${tail ? all.slice(-tail).join("") : ""}`;
}

export function truncateEnd(text: string, maxChars: number): string {
  const all = chars(text);
  if (all.length <= maxChars) return text;
  return `${all.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function unitMeta(unit: DiagramUnit): string {
  switch (unit.kind) {
    case "file":
      return `${formatCount(unit.lines)} lines`;
    case "unresolved":
      return "targets not found";
    case "boundary":
      return plural(unit.files, "file");
    default: {
      const partial = unit.reducedConfidence > 0 ? ` · ${unit.reducedConfidence} partial` : "";
      return `${plural(unit.files, "file")} · ${formatCount(unit.lines)} lines${partial}`;
    }
  }
}

/** The kicker line boundary units carry above their label. */
export function unitKicker(unit: DiagramUnit): string | null {
  if (unit.kind !== "boundary") return null;
  return unit.side === "in" ? "USED BY" : "USES";
}

export function unitBox(unit: DiagramUnit, preset: DiagramPreset, reserveCaption: boolean) {
  const type = TYPE_SCALE[preset];
  const limits = UNIT_WIDTH[preset];
  const inner = Math.max(monoWidth(unit.label, type.unitLabel), monoWidth(unitMeta(unit), type.unitMeta));
  const width = Math.min(limits.max, Math.max(limits.min, Math.ceil(inner + 2 * PAD_X)));
  const label = truncateMiddle(unit.label, monoChars(width - 2 * PAD_X, type.unitLabel));
  const kicker = unitKicker(unit) ? type.unitMeta * 1.3 : 0;
  const height = Math.ceil(
    PAD_TOP + kicker + type.unitLabel * 1.3 + type.unitMeta * 1.5
      + (reserveCaption ? type.caption * 1.5 : 0) + 8 + BAR + PAD_BOTTOM,
  );
  return { width, height, label };
}

export const UNIT_PADDING = { x: PAD_X, top: PAD_TOP, bottom: PAD_BOTTOM, bar: BAR } as const;

export function edgeStroke(count: number, preset: DiagramPreset): number {
  const base = Math.min(4.5, Math.max(1.25, 1.25 + 0.75 * Math.log2(Math.max(1, count))));
  return preset === "slide" ? base * 1.25 : base;
}
