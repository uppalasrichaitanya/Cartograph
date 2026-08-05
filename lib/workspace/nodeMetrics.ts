/**
 * The node box.
 *
 * How tall a node must be to draw what it contains, computed from the type
 * scale it is drawn in.
 *
 * WHY THIS EXISTS. The layout hands ELK a width and height per node, and React
 * Flow stamps those onto each node's wrapper as a fixed pixel box. Until now
 * they were literals sitting in prepareRenderData — 66 for a file, 82 for a
 * region, 52 for an unresolved stub — hand-calibrated against the typography of
 * the day and carrying no record of what they had been measured from.
 *
 * Phase 8 changed the typography. IBM Plex replaced Arial and `line-height:
 * 1.5` replaced no declaration at all, which grew every line box in a node by
 * roughly a quarter. The literals could not know that. A file node needed 86px
 * and was given 66, and because the card is sized against its wrapper the
 * remaining 20px was not clipped but simply painted outside the border: the
 * path — the third row — sat below the bottom edge of every file node on the
 * map.
 *
 * A number calibrated by eye against a stylesheet it cannot see will drift
 * again the next time the stylesheet moves. So the box is derived instead: the
 * rows a node draws are enumerated once, each row's height is its font size
 * times the leading plus its declared margin, and the total is what the layout
 * allocates. Changing the type scale now changes the geometry with it.
 *
 * MIRRORS app/globals.css. The values below restate tokens declared there —
 * unavoidably, because ELK runs in Node during analysis and cannot read a
 * stylesheet. tests/visual/nodeBox.test.ts parses globals.css and fails if the
 * two disagree, which is what keeps "mirrors" true rather than aspirational.
 *
 * @module lib/workspace/nodeMetrics
 */

import type { GeometryConfidence } from "@/types/graph";

/**
 * The metrics the box is built from, in CSS pixels at a 16px root.
 *
 * Each mirrors a declaration in globals.css; the comment names which.
 */
export const NODE_BOX = {
  /** body { line-height } — unitless, so each row scales with its own size. */
  leading: 1.5,
  /** --text-body: 0.875rem — the node's name. */
  textBody: 14,
  /** --text-micro: 0.6875rem — kicker, path, counts, markers. */
  textMicro: 11,
  /** --space-1: 0.25rem — under the kicker, above a marker. */
  space1: 4,
  /** --space-3: 0.75rem — .architecture-node padding, per side. */
  paddingY: 12,
  /** .architecture-node border, both edges summed. */
  borderY: 2,
  /**
   * The gap above a secondary line — `.architecture-node span { margin-top }`
   * and `.confidence-contains { margin-top }`.
   *
   * A literal in the stylesheet rather than a token, and restated as a literal
   * here so the two remain comparable. It is smaller than any step on the
   * spacing ramp on purpose: a path belongs to the name above it, and ramp
   * spacing would read as a separate row.
   */
  metaGap: 2,
} as const;

/** A single line of text, at a given size, including its leading. */
function line(fontSize: number): number {
  return fontSize * NODE_BOX.leading;
}

/** What a node draws, as far as its height is concerned. */
export type NodeBoxContent = {
  kind: "file" | "folder" | "unresolved";
  confidence: GeometryConfidence;
  /** Folders only: whether the "N files partially read" line is drawn. */
  hasReducedConfidenceCount?: boolean;
};

/**
 * Whether a confidence state draws a word-marker.
 *
 * Deliberately the same condition as `confidenceMarker` in DiagramView: full
 * evidence is the common case and carries no mark, so a mark always means
 * something. Both derive from the same rule; if the rule changes, both must.
 */
function drawsMarker(confidence: GeometryConfidence): boolean {
  return confidence === "heuristic" || confidence === "unknown";
}

/**
 * Height a node needs to draw its contents, in CSS pixels.
 *
 * The rows enumerated here are exactly the rows ArchitectureNode renders, in
 * the same order and under the same conditions.
 */
export function nodeBoxHeight(content: NodeBoxContent): number {
  const rows: number[] = [];

  // The kicker — FILE / FOLDER / IMPORT. Always drawn.
  rows.push(line(NODE_BOX.textMicro) + NODE_BOX.space1);

  // The name. Always drawn.
  rows.push(line(NODE_BOX.textBody));

  // The secondary line: a file's path, or a region's file count. An unresolved
  // stub has neither — there is no resolved location to state, and saying
  // nothing is the honest form of that.
  if (content.kind === "file" || content.kind === "folder") {
    rows.push(line(NODE_BOX.textMicro) + NODE_BOX.metaGap);
  }

  // A region's aggregate over its contents.
  if (content.kind === "folder" && content.hasReducedConfidenceCount) {
    rows.push(line(NODE_BOX.textMicro) + NODE_BOX.metaGap);
  }

  // The word-marker for a reduced-evidence state.
  if (drawsMarker(content.confidence)) {
    rows.push(line(NODE_BOX.textMicro) + NODE_BOX.space1);
  }

  const content_ = rows.reduce((total, row) => total + row, 0);
  return content_ + NODE_BOX.paddingY * 2 + NODE_BOX.borderY;
}

/**
 * Width allocated to a node, in CSS pixels.
 *
 * Unlike height, width is a composition choice rather than a consequence of
 * content: names and paths are ellipsized to fit, so a wider box would only
 * show more of a string nobody reads character-by-character at map zoom. These
 * are the widths the layout has always used, kept here so both dimensions are
 * stated in one place.
 */
export function nodeBoxWidth(kind: NodeBoxContent["kind"]): number {
  switch (kind) {
    case "folder":
      return 220;
    case "unresolved":
      return 190;
    default:
      return 230;
  }
}
