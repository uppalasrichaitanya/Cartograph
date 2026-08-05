/**
 * The node box must be able to hold what the node draws.
 *
 * WHAT BROKE. Phase 8 replaced the type system — IBM Plex in place of Arial,
 * and `line-height: 1.5` where there had previously been no declaration at all
 * (so, `normal`, ~1.2 for the old face). Every line box in a node grew. The
 * heights ELK is given, and therefore the pixel box React Flow stamps on each
 * node wrapper, did not: they were literals — 66, 82, 52 — calibrated by hand
 * against the old metrics and carrying no record of what they were measuring.
 *
 * `.architecture-node` is `height: 100%` of that wrapper, so the card could not
 * grow to meet its contents. The overflow was simply painted outside the
 * border: on a file node the path — the third row — sat ~7px below the bottom
 * edge, on every file node in the map. Measured in-browser, pre-fix:
 *
 *     file             needs 86.0   allocated 66   short 20.0
 *     file + marker    needs 106.5  allocated 66   short 40.5
 *     folder           needs 86.0   allocated 82   short  4.0
 *     folder + contains needs 104.5 allocated 82   short 22.5
 *     unresolved       needs 88.0   allocated 52   short 36.0
 *
 * WHAT THIS PROTECTS. Not the numbers. The property that the allocation is
 * DERIVED from the type scale rather than remembered alongside it. So the
 * expectations below are computed from `app/globals.css` — the file that
 * actually decides how tall a line is — and compared against what the layout
 * hands to ELK. Change the leading, the type scale, the padding or the spacing
 * ramp without telling the box model, and this fails here rather than silently
 * pushing text out of every card in the product.
 *
 * @module tests/visual/nodeBox.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  NODE_BOX,
  nodeBoxHeight,
  nodeBoxWidth,
  type NodeBoxContent,
} from "@/lib/workspace/nodeMetrics";

const CSS = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

/** Resolve a `:root` custom property to its declared value. */
function token(name: string): string {
  const value = CSS.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  assert.ok(value, `${name} should be declared in :root`);
  return value!.trim();
}

/** A rem-valued token, in pixels at the document's 16px root. */
function rem(name: string): number {
  const raw = token(name);
  const value = Number.parseFloat(raw);
  assert.ok(raw.endsWith("rem"), `${name} should be declared in rem, got ${raw}`);
  return value * 16;
}

/* ─── The CSS is the authority ────────────────────────────────────────────── */

test("the box model matches the type scale it is drawn in", () => {
  // Leading. Declared on body as a unitless factor, so every element's line
  // box is its own font-size times this.
  const leading = Number.parseFloat(
    CSS.match(/body\s*\{[^}]*line-height:\s*([\d.]+)/)?.[1] ?? "",
  );
  assert.ok(Number.isFinite(leading), "body should declare a unitless line-height");
  assert.equal(NODE_BOX.leading, leading);

  assert.equal(NODE_BOX.textBody, rem("--text-body"));
  assert.equal(NODE_BOX.textMicro, rem("--text-micro"));
  assert.equal(NODE_BOX.space1, rem("--space-1"));

  // Padding and border, read off the card's own rule.
  const rule = CSS.match(/\.architecture-node\s*\{([^}]*)\}/)?.[1] ?? "";
  const padding = rule.match(/padding:\s*var\(([^)]+)\)/)?.[1];
  assert.equal(padding, "--space-3", "the card should pad on the spacing ramp");
  assert.equal(NODE_BOX.paddingY, rem("--space-3"));

  const border = rule.match(/border:\s*([\d.]+)px/)?.[1];
  assert.equal(NODE_BOX.borderY, Number.parseFloat(border ?? "") * 2);
});

/* ─── Every composition the renderer can produce ──────────────────────────── */

/**
 * The rows each node kind actually draws, mirroring ArchitectureNode.
 *
 * Heights are computed here from first principles — line box = font-size ×
 * leading, plus the declared margin — rather than copied from the module under
 * test, so agreement means two independent derivations landed in the same
 * place.
 */
const CASES: ReadonlyArray<{ name: string; content: NodeBoxContent; rows: number[] }> = [
  {
    name: "file",
    content: { kind: "file", confidence: "verified" },
    // kicker (+space-1), name, path (+2px)
    rows: [11 * 1.5 + 4, 14 * 1.5, 11 * 1.5 + 2],
  },
  {
    name: "file, partially read",
    content: { kind: "file", confidence: "heuristic" },
    rows: [11 * 1.5 + 4, 14 * 1.5, 11 * 1.5 + 2, 11 * 1.5 + 4],
  },
  {
    name: "folder",
    content: { kind: "folder", confidence: "derived" },
    rows: [11 * 1.5 + 4, 14 * 1.5, 11 * 1.5 + 2],
  },
  {
    name: "folder holding partially read files",
    content: { kind: "folder", confidence: "derived", hasReducedConfidenceCount: true },
    rows: [11 * 1.5 + 4, 14 * 1.5, 11 * 1.5 + 2, 11 * 1.5 + 2],
  },
  {
    name: "unresolved import",
    content: { kind: "unresolved", confidence: "unknown" },
    // No path row: a stub has no resolved location to state.
    rows: [11 * 1.5 + 4, 14 * 1.5, 11 * 1.5 + 4],
  },
];

for (const { name, content, rows } of CASES) {
  test(`a ${name} node is allocated enough height to draw itself`, () => {
    const required = rows.reduce((a, b) => a + b, 0) + 12 * 2 + 1 * 2;
    assert.equal(
      nodeBoxHeight(content),
      required,
      `${name}: the box must hold ${required}px of content`,
    );
  });
}

test("width is stated per kind and never zero", () => {
  for (const kind of ["file", "folder", "unresolved"] as const) {
    assert.ok(nodeBoxWidth(kind) > 0);
  }
});

/* ─── The card is never smaller than what it holds ────────────────────────── */

test("the card may grow past its allocation rather than paint outside it", () => {
  const rule = CSS.match(/\.architecture-node\s*\{([^}]*)\}/)?.[1] ?? "";

  // `height: 100%` is what turned an under-estimate into text outside the
  // border: it pinned the card to the wrapper and let the remainder spill.
  // min-height keeps the card filling its allocation while leaving it free to
  // grow, so a future row added without updating the box model degrades to a
  // slightly tall card rather than to text floating in the canvas.
  assert.ok(
    !/[^-]height:\s*100%/.test(rule),
    ".architecture-node must not pin its height to the wrapper",
  );
  assert.match(rule, /min-height:\s*100%/);
});

test("every row in a node is a block", () => {
  // The height model sums each row as its own line box. That is only true
  // while every row IS its own line box: an inline-block row instead joins a
  // line governed by the card's strut — 21px, from the name's body size — and
  // baseline alignment makes it taller than the row's own leading. That is
  // what the marker did, and it cost a marked node ~1px it was never given.
  for (const selector of [".confidence-marker", ".confidence-contains"]) {
    const rule = CSS.match(
      new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`),
    )?.[1];
    assert.ok(rule, `${selector} should be declared`);
    assert.match(
      rule!,
      /display:\s*block/,
      `${selector} must be a block for the height model to hold`,
    );
  }
});
