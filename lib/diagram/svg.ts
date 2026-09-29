/**
 * The figure: a presentation-grade SVG of a positioned diagram.
 *
 * Laid out like a printed plate: a designation and title, the drawing, then
 * notes, a legend, what was left out, and where it came from. Every string is
 * escaped, nothing loads from outside the file, and every drawn character is
 * in the embedded Latin fonts: arrows, cycle marks and note numbers are
 * shapes, not glyphs.
 *
 * @module lib/diagram/svg
 */
import { fontFaceCss } from "./fonts";
import {
  BUDGETS, DOCUMENT_CANVAS, edgeStroke, monoChars, SLIDE_CANVAS, TYPE_SCALE,
  truncateEnd, UNIT_PADDING, unitBox, unitKicker, unitMeta,
} from "./metrics";
import { THEMES, type DiagramTheme } from "./theme";
import type { Box, DiagramNote, DiagramOptions, DiagramReviewAnnotations, DiagramUnit, Point, PositionedDiagram } from "./types";

export type RenderSvgInput = Readonly<{
  positioned: PositionedDiagram;
  options: DiagramOptions;
  annotations: DiagramReviewAnnotations;
  origin: string;
  embedFonts?: boolean;
}>;

export type RenderedSvg = Readonly<{ svg: string; width: number; height: number; scale: number }>;

const esc = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Keep only characters the embedded Latin subsets can draw. */
const latin = (value: string) => [...value]
  .map((char) => {
    const code = char.codePointAt(0)!;
    return (code >= 0x20 && code <= 0xff) || (code >= 0x2000 && code <= 0x206f) ? char : "?";
  })
  .join("");

const text = (value: string) => esc(latin(value));
const num = (value: number) => String(Math.round(value * 100) / 100);

type Line = { kind: "externals" | "note" | "legend" | "omissions" | "provenance"; text: string; note?: number; source?: DiagramNote["source"] };

function styleBlock(theme: DiagramTheme, embedFonts: boolean, italic: boolean): string {
  const fonts = embedFonts ? fontFaceCss({ italic }) : "";
  return `<style>${fonts}`
    + `.m4{font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:400}`
    + `.m6{font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:600}`
    + `.s6{font-family:"IBM Plex Sans",system-ui,sans-serif;font-weight:600}`
    + `.si{font-family:"IBM Plex Sans",system-ui,sans-serif;font-weight:400;font-style:italic}`
    + `.ink{fill:${theme.ink}}.muted{fill:${theme.inkMuted}}.faint{fill:${theme.inkFaint}}`
    + `.accent{fill:${theme.accent}}.assisted{fill:${theme.assisted}}`
    + `</style>`;
}

function edgePath(points: ReadonlyArray<Point>, curved: boolean): string {
  const [start, ...rest] = points;
  if (!curved) return `M${num(start.x)} ${num(start.y)}${rest.map((point) => `L${num(point.x)} ${num(point.y)}`).join("")}`;
  let d = `M${num(start.x)} ${num(start.y)}`;
  for (let i = 0; i + 2 < rest.length; i += 3) {
    d += `C${num(rest[i].x)} ${num(rest[i].y)} ${num(rest[i + 1].x)} ${num(rest[i + 1].y)} ${num(rest[i + 2].x)} ${num(rest[i + 2].y)}`;
  }
  return d;
}

function markerId(kind: "plain" | "cycle", stroke: number): string {
  return `ah-${kind}-${Math.round(stroke * 100)}`;
}

function marker(kind: "plain" | "cycle", stroke: number, fill: string): string {
  const size = num(7 + 2 * stroke);
  return `<marker id="${markerId(kind, stroke)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${size}" markerHeight="${size}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 1L9 5L0 9Z" fill="${fill}"/></marker>`;
}

/** A small circular arrow: the cycle mark, drawn rather than typed. */
function cycleGlyph(x: number, y: number, color: string): string {
  return `<g class="cycle-mark" fill="none" stroke="${color}" stroke-width="1.4"><path d="M${num(x + 5)} ${num(y)}A5 5 0 1 1 ${num(x)} ${num(y - 5)}"/><path d="M${num(x - 2)} ${num(y - 8)}L${num(x)} ${num(y - 5)}L${num(x - 3)} ${num(y - 3)}"/></g>`;
}

function noteMarker(x: number, y: number, n: number, theme: DiagramTheme, size: number): string {
  return `<g class="note-marker"><circle cx="${num(x)}" cy="${num(y)}" r="${num(size * 0.75)}" fill="${theme.accent}"/><text x="${num(x)}" y="${num(y + size * 0.35)}" text-anchor="middle" class="m6" font-size="${num(size)}" fill="${theme.surface}">${n}</text></g>`;
}

export function renderSvg(input: RenderSvgInput): RenderedSvg {
  const { positioned, options, annotations, origin } = input;
  const embedFonts = input.embedFonts ?? true;
  const { model } = positioned;
  const preset = options.preset;
  const type = TYPE_SCALE[preset];
  const theme = THEMES[options.theme];
  const showCaptions = options.annotations === "measured+ai";
  const captions = showCaptions ? annotations.captions : new Map<string, string>();
  const notes = options.annotations === "none" ? [] : annotations.notes.slice(0, BUDGETS[preset].notes);
  const margin = preset === "slide" ? SLIDE_CANVAS.margin : DOCUMENT_CANVAS.margin;
  const gap = Math.round(type.subtitle * 2);

  // ── Footer lines (measured first, so their count sizes the canvas) ──
  const lines: Line[] = [];
  if (options.showExternal && model.externalPackages.length > 0) {
    lines.push({ kind: "externals", text: `Depends on: ${model.externalPackages.map((pkg) => pkg.name).join(" · ")}` });
  }
  notes.forEach((note, index) => lines.push({ kind: "note", text: note.text, note: index + 1, source: note.source }));
  lines.push({ kind: "legend", text: "" });
  const omissions: string[] = [];
  if (model.edges.length === 0) omissions.push("No internal imports were found.");
  if (model.omitted.testFiles > 0) omissions.push(`Tests hidden (${model.omitted.testFiles} files)`);
  if (model.omitted.edges > 0) omissions.push(`${model.omitted.edges} weaker connections (at most ${model.omitted.edgeMaxCount} imports each) not drawn`);
  if (model.omitted.files > 0) omissions.push(`${model.omitted.files} less-connected files grouped`);
  if (model.partialEvidence) omissions.push("Partial evidence (analysis predates confidence tracking)");
  if (positioned.simplified) omissions.push("Simplified layout");
  if (omissions.length > 0) lines.push({ kind: "omissions", text: omissions.join(" · ") });
  const shareUrl = `${origin.replace(/\/$/, "")}/repo/${model.analysisId}`;
  lines.push({ kind: "provenance", text: `Generated by Cartograph · verified from import statements · analysed ${model.analyzedAt.slice(0, 10)} · ${shareUrl}` });
  const lineHeight = Math.round(type.footer * 2.1);
  const footerHeight = lines.length * lineHeight + gap;

  // ── Canvas and body scale ──
  const headerHeight = Math.round(type.eyebrow * 1.8 + type.title * 1.3 + type.subtitle * 1.9 + gap / 2);
  const bodyWidth = Math.max(1, positioned.width);
  const bodyHeight = Math.max(1, positioned.height);
  let width: number;
  let height: number;
  let scale: number;
  if (preset === "slide") {
    width = SLIDE_CANVAS.width;
    height = SLIDE_CANVAS.height;
    const availableHeight = height - 2 * margin - headerHeight - footerHeight - gap;
    scale = Math.min(SLIDE_CANVAS.maxScale, (width - 2 * margin) / bodyWidth, Math.max(1, availableHeight) / bodyHeight);
  } else {
    scale = Math.min(1, (DOCUMENT_CANVAS.maxWidth - 2 * margin) / bodyWidth);
    width = Math.max(DOCUMENT_CANVAS.minWidth, Math.ceil(bodyWidth * scale + 2 * margin));
    height = Math.max(DOCUMENT_CANVAS.minHeight, Math.ceil(margin + headerHeight + gap + bodyHeight * scale + gap + footerHeight + margin));
  }
  const bodyX = (width - bodyWidth * scale) / 2;
  const bodyTop = margin + headerHeight + gap;
  const bodyY = preset === "slide" ? bodyTop + Math.max(0, (height - margin - footerHeight - gap - bodyTop - bodyHeight * scale) / 2) : bodyTop;
  const footerY = preset === "slide" ? height - margin - footerHeight + gap : bodyY + bodyHeight * scale + gap + gap;

  const parts: string[] = [];
  const title = latin(model.title);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">`);
  parts.push(`<title id="t">${esc(title)}</title><desc id="d">${text(`${model.subtitle}. ${omissions.join(". ")}`)}</desc>`);
  parts.push(styleBlock(theme, embedFonts, captions.size > 0));

  // ── Markers ──
  const markers = new Set<string>();
  for (const { edge } of positioned.edges) {
    const stroke = edgeStroke(edge.count, preset);
    const kind = edge.inCycle ? "cycle" : "plain";
    const id = markerId(kind, stroke);
    if (!markers.has(id)) {
      markers.add(id);
      parts.push(`<defs>${marker(kind, stroke, edge.inCycle ? theme.cycle : theme.inkMuted)}</defs>`);
    }
  }
  if (!markers.has(markerId("plain", 1.25))) parts.push(`<defs>${marker("plain", 1.25, theme.inkMuted)}</defs>`);

  if (options.background === "solid") parts.push(`<rect width="${width}" height="${height}" fill="${theme.ground}"/>`);

  // ── Header ──
  const eyebrowY = margin + type.eyebrow;
  const designation = model.scope.kind === "repository" ? "FIG. · ARCHITECTURE OVERVIEW" : "FIG. · REGION DETAIL";
  parts.push(`<path d="M${margin} ${num(eyebrowY - type.eyebrow * 0.35)}h28" stroke="${theme.accent}" stroke-width="1"/>`);
  parts.push(`<text x="${margin + 38}" y="${num(eyebrowY)}" class="m6 accent" font-size="${type.eyebrow}" letter-spacing="1.2">${designation}</text>`);
  parts.push(`<text x="${width - margin}" y="${num(eyebrowY)}" text-anchor="end" class="m4 faint" font-size="${type.eyebrow}">${text(model.analyzedAt.slice(0, 10))}</text>`);
  const titleY = eyebrowY + type.title * 1.3;
  parts.push(`<text x="${margin}" y="${num(titleY)}" class="s6 ink" font-size="${type.title}">${text(truncateEnd(model.title, Math.floor((width - 2 * margin) / (type.title * 0.58))))}</text>`);
  const subtitleY = titleY + type.subtitle * 1.9;
  parts.push(`<text x="${margin}" y="${num(subtitleY)}" class="m4 muted" font-size="${type.subtitle}">${text(model.subtitle)}</text>`);
  parts.push(`<path d="M${margin} ${num(margin + headerHeight)}H${width - margin}" stroke="${theme.rule}" stroke-width="1"/>`);

  // ── Body ──
  parts.push(`<g transform="translate(${num(bodyX)} ${num(bodyY)}) scale(${num(scale)})">`);
  for (const group of model.groups) {
    const box = positioned.groups.get(group.id);
    if (!box) continue;
    parts.push(`<g class="group"><rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" rx="10" fill="none" stroke="${theme.ruleStrong}" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${num(box.x + 14)}" y="${num(box.y + type.groupTitle * 1.7)}" class="m6 muted" font-size="${type.groupTitle}">${text(truncateEnd(group.label, monoChars(box.width - 90, type.groupTitle)))}</text>`);
    parts.push(`<text x="${num(box.x + box.width - 14)}" y="${num(box.y + type.groupTitle * 1.7)}" text-anchor="end" class="m4 faint" font-size="${type.groupTitle}">${group.files} files</text></g>`);
  }
  for (const { edge, points, curved, label } of positioned.edges) {
    const stroke = edgeStroke(edge.count, preset);
    const unresolved = edge.to === "u:#unresolved";
    const color = edge.inCycle ? theme.cycle : theme.inkMuted;
    const dash = unresolved ? ` stroke-dasharray="2 4"` : edge.inCycle && theme.cycleDash ? ` stroke-dasharray="${theme.cycleDash}"` : "";
    const head = unresolved ? "" : ` marker-end="url(#${markerId(edge.inCycle ? "cycle" : "plain", stroke)})"`;
    parts.push(`<path class="edge" d="${edgePath(points, curved)}" fill="none" stroke="${color}" stroke-width="${num(stroke)}" stroke-linecap="round"${dash}${head}/>`);
    if (label) {
      parts.push(`<rect x="${num(label.x)}" y="${num(label.y)}" width="${num(label.width)}" height="${num(label.height)}" rx="${num(label.height / 2)}" fill="${theme.ground}"/>`);
      parts.push(`<text x="${num(label.x + label.width / 2)}" y="${num(label.y + label.height * 0.72)}" text-anchor="middle" class="m4 muted" font-size="${type.edgeLabel}">${edge.count}</text>`);
    }
  }

  const barUnits = model.units.filter((unit) => unit.kind === "folder" || unit.kind === "loose-files" || unit.kind === "file");
  const weightOf = (unit: DiagramUnit) => (unit.kind === "file" ? unit.lines : unit.files);
  const maxWeight = Math.max(1, ...barUnits.map(weightOf));
  const markersByUnit = new Map<string, number[]>();
  notes.forEach((note, index) => {
    const subject = note.subjects.map((id) => (id.startsWith("e:") ? id.slice(2).split("->")[0] : id)).find((id) => positioned.units.has(id));
    if (subject) markersByUnit.set(subject, [...(markersByUnit.get(subject) ?? []), index + 1]);
  });

  for (const unit of model.units) {
    const box = positioned.units.get(unit.id);
    if (box) parts.push(renderUnit(unit, box, { preset, theme, type, reserveCaption: positioned.reserveCaption, caption: captions.get(unit.id), barShare: barUnits.includes(unit) ? weightOf(unit) / maxWeight : null, noteNumbers: markersByUnit.get(unit.id) ?? [] }));
  }
  parts.push(`</g>`);

  // ── Footer ──
  parts.push(`<path d="M${margin} ${num(footerY - gap / 2)}H${width - margin}" stroke="${theme.rule}" stroke-width="1"/>`);
  const maxChars = monoChars(width - 2 * margin - 24, type.footer);
  lines.forEach((line, index) => {
    const y = footerY + index * lineHeight + type.footer;
    if (line.kind === "legend") {
      parts.push(renderLegend(margin, y, type.footer, theme, captions.size > 0));
      return;
    }
    if (line.kind === "note") {
      parts.push(noteMarker(margin + type.footer * 0.8, y - type.footer * 0.35, line.note!, theme, type.footer));
      const tag = line.source === "ai" ? `<tspan class="m6 assisted">AI </tspan>` : "";
      parts.push(`<text x="${num(margin + type.footer * 2.4)}" y="${num(y)}" class="m4 ink" font-size="${type.footer}">${tag}${text(truncateEnd(line.text, maxChars - 6))}</text>`);
      return;
    }
    const cls = line.kind === "provenance" ? "m4 faint" : "m4 muted";
    parts.push(`<text x="${margin}" y="${num(y)}" class="${cls}" font-size="${type.footer}">${text(truncateEnd(line.text, maxChars))}</text>`);
  });

  parts.push(`</svg>`);
  return { svg: parts.join(""), width, height, scale };
}

type UnitContext = Readonly<{
  preset: DiagramOptions["preset"];
  theme: DiagramTheme;
  type: (typeof TYPE_SCALE)[DiagramOptions["preset"]];
  reserveCaption: boolean;
  caption: string | undefined;
  barShare: number | null;
  noteNumbers: ReadonlyArray<number>;
}>;

function renderUnit(unit: DiagramUnit, box: Box, context: UnitContext): string {
  const { theme, type } = context;
  const { label } = unitBox(unit, context.preset, context.reserveCaption);
  const x = box.x + UNIT_PADDING.x;
  const kicker = unitKicker(unit);
  const unresolved = unit.kind === "unresolved";
  const fill = unit.kind === "boundary" ? theme.well : unresolved ? theme.ground : theme.surface;
  const stroke = unresolved ? theme.rule : theme.ruleStrong;
  const dash = unresolved || unit.kind === "overflow" ? ` stroke-dasharray="5 3"` : "";
  const out: string[] = [];
  const tooltip = `${unit.path || unit.label} · ${unitMeta(unit)}${unit.internalImports ? ` · ${unit.internalImports} internal imports` : ""}`;
  out.push(`<g class="unit-group"><title>${text(tooltip)}</title>`);
  out.push(`<rect class="unit" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" rx="6" fill="${fill}" stroke="${stroke}"${dash}/>`);
  let y = box.y + UNIT_PADDING.top;
  if (kicker) {
    y += type.unitMeta * 1.1;
    out.push(`<text x="${num(x)}" y="${num(y)}" class="m6 faint" font-size="${num(type.unitMeta * 0.8)}" letter-spacing="1">${kicker}</text>`);
    y += type.unitMeta * 0.2;
  }
  y += type.unitLabel * 1.05;
  out.push(`<text x="${num(x)}" y="${num(y)}" class="m6 ${unresolved ? "faint" : "ink"}" font-size="${type.unitLabel}">${text(label)}</text>`);
  y += type.unitMeta * 1.5;
  out.push(`<text x="${num(x)}" y="${num(y)}" class="m4 muted" font-size="${type.unitMeta}">${text(unitMeta(unit))}</text>`);
  if (context.reserveCaption && context.caption) {
    y += type.caption * 1.5;
    const chars = Math.max(1, Math.floor((box.width - 2 * UNIT_PADDING.x - type.caption * 1.5) / (type.caption * 0.52)));
    out.push(`<text x="${num(x)}" y="${num(y)}" font-size="${type.caption}"><tspan class="m6 assisted" font-size="${num(type.caption * 0.8)}">AI </tspan><tspan class="si assisted">${text(truncateEnd(context.caption, chars))}</tspan></text>`);
  }
  if (context.barShare !== null) {
    const barWidth = box.width - 2 * UNIT_PADDING.x;
    const barY = box.y + box.height - UNIT_PADDING.bottom - UNIT_PADDING.bar;
    out.push(`<rect x="${num(x)}" y="${num(barY)}" width="${num(barWidth)}" height="${UNIT_PADDING.bar}" rx="1.5" fill="${theme.well}"/>`);
    out.push(`<rect x="${num(x)}" y="${num(barY)}" width="${num(barWidth * context.barShare)}" height="${UNIT_PADDING.bar}" rx="1.5" fill="${theme.ruleStrong}"/>`);
  }
  if (unit.inCycle) out.push(`<circle cx="${num(box.x + box.width - 16)}" cy="${num(box.y)}" r="10" fill="${theme.ground}" stroke="${theme.cycle}" stroke-width="1"/>${cycleGlyph(box.x + box.width - 16, box.y + 4, theme.cycle)}`);
  context.noteNumbers.forEach((n, index) => {
    out.push(noteMarker(box.x + box.width - (unit.inCycle ? 42 : 14) - index * type.unitMeta * 1.6, box.y, n, theme, type.unitMeta));
  });
  out.push(`</g>`);
  return out.join("");
}

function renderLegend(x: number, y: number, size: number, theme: DiagramTheme, withCaptions: boolean): string {
  const out: string[] = [];
  let cursor = x;
  const item = (sample: string, label: string, sampleWidth: number) => {
    out.push(sample.replace(/\{x\}/g, num(cursor)).replace(/\{y\}/g, num(y - size * 0.35)));
    out.push(`<text x="${num(cursor + sampleWidth + 6)}" y="${num(y)}" class="m4 muted" font-size="${size}">${text(label)}</text>`);
    cursor += sampleWidth + 6 + [...label].length * size * 0.6 + 22;
  };
  item(`<rect x="{x}" y="${num(y - size * 0.8)}" width="16" height="${num(size * 0.9)}" rx="2" fill="${theme.surface}" stroke="${theme.ruleStrong}"/>`, "part of the code", 16);
  item(`<path d="M{x} {y}h22" stroke="${theme.inkMuted}" stroke-width="1.5" marker-end="url(#${markerId("plain", 1.25)})"/>`, "imports (number = file-level imports)", 26);
  item(`<path d="M{x} {y}h22" stroke="${theme.cycle}" stroke-width="1.5"${theme.cycleDash ? ` stroke-dasharray="${theme.cycleDash}"` : ""}/>`, "import cycle", 22);
  item(`<rect x="{x}" y="${num(y - size * 0.8)}" width="16" height="${num(size * 0.9)}" rx="2" fill="none" stroke="${theme.rule}" stroke-dasharray="3 2"/>`, "unresolved or grouped", 16);
  if (withCaptions) item(`<text x="{x}" y="${num(y)}" class="m6 assisted" font-size="${num(size * 0.9)}">AI</text>`, "generated caption, not measured", 14);
  return out.join("");
}
