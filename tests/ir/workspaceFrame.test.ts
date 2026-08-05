/**
 * Phase 3 — Information Architecture
 *
 * The workspace became a fixed frame: it occupies the viewport exactly, and
 * nothing scrolls except content inside the inspector.
 *
 * These tests lock the structural commitments. They are deliberately about
 * structure rather than appearance — which region exists, what may scroll,
 * whether the map is ever resized — because those are the properties every
 * later phase inherits and the ones a well-meaning edit could quietly undo.
 *
 * @module tests/ir/workspaceFrame.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const DIAGRAM = readFileSync(
  path.join(process.cwd(), "components", "DiagramView.tsx"),
  "utf8",
);
const PANEL = readFileSync(
  path.join(process.cwd(), "components", "FileDetailPanel.tsx"),
  "utf8",
);
const SEARCH = readFileSync(
  path.join(process.cwd(), "components", "SearchOverlay.tsx"),
  "utf8",
);

/**
 * Source with comments stripped.
 *
 * Several of these assertions check that a mechanism is ABSENT. A comment
 * explaining why it was removed would otherwise trip them — the removal
 * rationale is worth keeping, so the assertions look at code only.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const DIAGRAM_CODE = code(DIAGRAM);
const PANEL_CODE = code(PANEL);

/** Extract the declaration body of a CSS rule, asserting it exists. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `expected a CSS rule for ${selector}`);
  return match![1];
}

/**
 * A rule's declarations with `var(--token)` references resolved to the values
 * `:root` gives them.
 *
 * Phase 8 moved literals into tokens, so a rule that used to read `56px` now
 * reads `var(--rail-height)`. The assertions below still make the same claims
 * about the same numbers; resolving here keeps them checking the value that
 * actually reaches the browser rather than the spelling of the reference.
 */
function resolved(declarations: string): string {
  return declarations.replace(/var\((--[\w-]+)\)/g, (whole, token) => {
    const value = CSS.match(new RegExp(`\\s${token}:\\s*([^;]+);`))?.[1];
    return value ? value.trim() : whole;
  });
}

/**
 * Resolve a font-size declaration to a number of rem.
 *
 * Sizes are declared as scale tokens rather than literals since Phase 8, so
 * reading one means following it to its definition. The assertions that use
 * this are unchanged — what a rule must be *larger than* is still the claim
 * being made; only the indirection is new.
 */
function fontSizeRem(declarations: string): number {
  const declared = declarations.match(/font-size:\s*([^;]+);/)?.[1].trim();
  assert.ok(declared, "expected a font-size declaration");

  const literal = declared!.match(/^([\d.]+)rem$/);
  if (literal) return Number.parseFloat(literal[1]);

  const token = declared!.match(/^var\((--[\w-]+)\)$/);
  assert.ok(token, `font-size should be a rem literal or a scale token: ${declared}`);
  const value = CSS.match(new RegExp(`${token![1]}:\\s*([\\d.]+)rem`))?.[1];
  assert.ok(value, `scale token ${token![1]} should be defined in rem`);
  return Number.parseFloat(value!);
}

// ---------------------------------------------------------------------------
// The frame occupies the viewport
// ---------------------------------------------------------------------------

test("Phase 3 — the workspace is a fixed frame, not a scrolling document", async (t) => {
  await t.test("the frame is exactly viewport-sized", () => {
    const frame = rule(".workspace-frame");
    assert.match(frame, /height:\s*100dvh/);
    assert.match(frame, /overflow:\s*hidden/);
  });

  await t.test("the frame is two regions: a fixed rail and everything else", () => {
    const frame = rule(".workspace-frame");
    // The map must take all remaining space — not a fixed or viewport-relative
    // height that could leave the primary representation partially off-screen.
    assert.match(resolved(frame), /grid-template-rows:\s*56px 1fr/);
  });

  await t.test("the map is never given its own scroll height", () => {
    const map = rule(".map-region");
    assert.ok(
      !/min-height/.test(map),
      "a min-height would let the map exceed the frame and reintroduce scrolling",
    );
    assert.ok(!/height:\s*\d+vh/.test(map), "the map must not be viewport-fraction sized");
  });

  await t.test("the old scrolling-document geometry is gone", () => {
    // .canvas-card was height: min(78vh, 860px) inside a min-height: 100vh
    // page — the map could scroll out of view entirely.
    for (const dead of [".diagram-page", ".canvas-card", ".diagram-title-row", ".summary-grid"]) {
      assert.ok(
        !new RegExp(`\\${dead}\\b`).test(CSS),
        `${dead} belonged to the scrolling document and must be gone`,
      );
      assert.ok(!DIAGRAM_CODE.includes(dead.slice(1)), `${dead} must not be rendered`);
    }
  });

  await t.test("only the inspector scrolls", () => {
    assert.match(rule(".detail-panel"), /overflow:\s*auto/);
    assert.match(rule(".map-region"), /overflow:\s*hidden/);
  });

  await t.test("the frame cannot be widened by its own content", () => {
    // Caught in manual verification: at a 375px viewport the map measured
    // 543px. A grid track sized `auto` cannot shrink below its content's
    // min-content width, so the rail was pushing the column — and the map
    // with it — past the viewport, where overflow:hidden clipped roughly a
    // third of the map out of reach.
    assert.match(
      rule(".workspace-frame"),
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
      "the frame's column must be allowed to shrink to the viewport",
    );
    assert.match(
      rule(".rail"),
      /min-width:\s*0/,
      "a flex container without min-width:0 refuses to shrink below its content",
    );
  });

  await t.test("the repository name survives every viewport", () => {
    // Things yield in order of contribution to orientation. The name is what
    // tells you where you are, so it never drops.
    const narrow = CSS.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/)?.[1];
    assert.ok(narrow, "a narrow-viewport block must exist");
    assert.ok(
      !/\.rail-repo-name\s*\{[^}]*display:\s*none/.test(narrow!),
      "the repository name must never be hidden",
    );
    assert.match(narrow!, /\.rail-repo-meta\s*\{\s*display:\s*none/);
  });
});

// ---------------------------------------------------------------------------
// The camera moves; the world does not
// ---------------------------------------------------------------------------

test("Phase 3 — the inspector offsets the camera, never resizes the map", async (t) => {
  await t.test("the canvas-shrink handshake is gone", () => {
    // The map used to shrink by the panel's width while a transitionend
    // listener re-centred the camera — two coupled systems, with a hardcoded
    // pixel fallback, computing a negative width on narrow viewports.
    assert.ok(!/has-panel-open/.test(CSS), "the width-coupling class must be gone");
    assert.ok(!/has-panel-open/.test(DIAGRAM_CODE));
    assert.ok(
      !/transitionend/.test(DIAGRAM_CODE),
      "nothing should wait on a layout transition that no longer happens",
    );
  });

  await t.test("no rule resizes the map when the inspector opens", () => {
    const map = rule(".map-region");
    assert.ok(
      !/width:\s*calc/.test(map),
      "the map's width must not depend on the panel",
    );
  });

  await t.test("the camera offset derives from the panel's own width", () => {
    // Reading the same custom property the panel is sized by means the camera
    // and the panel cannot disagree about how much of the map is covered.
    const helper = DIAGRAM.match(/function inspectorWidth\(\)[\s\S]*?\n}/)?.[0];
    assert.ok(helper, "an inspectorWidth helper must exist");
    assert.match(helper!, /--panel-width/);
    assert.ok(
      !/\+ 100\b/.test(DIAGRAM_CODE),
      "the hardcoded +100px fallback offset must be gone",
    );
  });

  await t.test("the offset accounts for zoom", () => {
    // setCenter takes world coordinates; the panel width is a screen distance.
    const helper = DIAGRAM.match(/function centeredWithInspector[\s\S]*?\n}/)?.[0];
    assert.ok(helper);
    assert.match(helper!, /zoom/);
  });

  await t.test("both navigation paths use the same rule", () => {
    // A node should come to rest in the same place regardless of whether it
    // was clicked, searched for, or reached from the inspector.
    const uses = DIAGRAM.match(/centeredWithInspector\(/g) ?? [];
    assert.ok(
      uses.length >= 3,
      `expected the shared helper at every camera call site, found ${uses.length}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Removals
// ---------------------------------------------------------------------------

test("Phase 3 — removals", async (t) => {
  await t.test("the minimap is gone", () => {
    assert.ok(!/MiniMap/.test(DIAGRAM_CODE));
    assert.ok(!/react-flow__minimap/.test(CSS));
  });

  await t.test("the permanent keyboard hint is gone", () => {
    // Instruction text living inside the primary representation.
    assert.ok(!/kbd-hint/.test(DIAGRAM_CODE));
    assert.ok(!/\.kbd-hint\b/.test(CSS));
  });

  await t.test("dead selectors are gone", () => {
    for (const dead of [".back-button", ".zoom-level", ".progress-stream"]) {
      assert.ok(
        !new RegExp(`\\${dead}\\b`).test(CSS),
        `${dead} is referenced by no component and must be gone`,
      );
    }
  });

  await t.test("the dead node class hook is gone", () => {
    assert.ok(
      !/architecture-node-\$\{/.test(DIAGRAM_CODE),
      "a generated class with no CSS behind it is noise",
    );
  });

  await t.test("copy-to-clipboard actions are gone from the inspector", () => {
    // They operated the tool rather than advancing understanding, and took
    // the most valuable space in the panel to do it.
    assert.ok(!/Copy Path/.test(PANEL_CODE));
    assert.ok(!/Copy Name/.test(PANEL_CODE));
    assert.ok(!/clipboard/.test(PANEL_CODE), "no clipboard machinery should remain");
  });

  await t.test("Reveal in graph survives", () => {
    // It returns attention to the map, which is where understanding forms.
    assert.match(PANEL, /Reveal in graph/);
  });

  await t.test("no emoji remain on the workspace surface", () => {
    // They render differently per platform, carry no consistent semantic, and
    // cannot participate in the confidence encoding.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const [name, source] of [
      ["DiagramView", DIAGRAM_CODE],
      ["FileDetailPanel", PANEL_CODE],
      ["SearchOverlay", code(SEARCH)],
    ] as const) {
      const found = source.match(emoji);
      assert.ok(!found, `${name} still contains emoji: ${found?.[0]}`);
    }
  });

  await t.test("dead focus-mode state is gone", () => {
    assert.ok(
      !/focusMode/.test(DIAGRAM_CODE),
      "nothing ever set it true; its branch was unreachable",
    );
  });
});

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

test("Phase 3 — the four regions", async (t) => {
  await t.test("the rail exists and is fixed height", () => {
    assert.match(DIAGRAM, /className="rail"/);
    assert.match(resolved(rule(".workspace-frame")), /56px/);
  });

  await t.test("the repository name is the most prominent text in the rail", () => {
    // The project is the subject; Cartograph is the instrument.
    const name = rule(".rail-repo-name");
    const mark = rule(".rail-mark");
    const nameSize = fontSizeRem(name);
    const markSize = fontSizeRem(mark);
    assert.ok(
      nameSize > markSize,
      `repo name (${nameSize}rem) must outweigh the product mark (${markSize}rem)`,
    );
    assert.match(name, /font-weight:\s*700/);
  });

  await t.test("the context cluster is anchored over the map", () => {
    const cluster = rule(".context-cluster");
    assert.match(cluster, /position:\s*absolute/);
    assert.match(cluster, /bottom:/);
    assert.match(cluster, /left:/);
    assert.match(DIAGRAM, /className="context-cluster"/);
  });

  await t.test("there is no permanent left sidebar", () => {
    // A permanent nav rail taxes attention on every frame in exchange for
    // capability used occasionally. Lenses expand on intent, collapse after.
    //
    // The test is that the frame has exactly ONE column — not that it declares
    // no columns at all. It does declare one, minmax(0, 1fr), so the track can
    // shrink to the viewport; a single full-width column is not a sidebar.
    const frame = rule(".workspace-frame");
    assert.match(frame, /grid-template-rows/);
    const columns = frame.match(/grid-template-columns:\s*([^;]+);/)?.[1].trim();
    assert.ok(columns, "the frame should declare its single column explicitly");
    assert.equal(
      columns,
      "minmax(0, 1fr)",
      "the frame must be one shrinkable column, never a sidebar plus content",
    );
  });

  await t.test("search occupies its place in the rail", () => {
    // Phase 3 reserved this slot and asserted it was deliberately unfilled.
    // Phase 5 filled it: search is a visible affordance now, not a shortcut a
    // person had to already know about. What still matters is that it lives in
    // the rail and takes the slack there, so the rail's proportions hold.
    assert.match(DIAGRAM_CODE, /className="rail-search"/);
    assert.match(rule(".rail-search"), /flex:\s*1/);
  });
});

// ---------------------------------------------------------------------------
// The focus contract
// ---------------------------------------------------------------------------

test("Phase 3 — the focus contract reaches the element it styles", async (t) => {
  // Found in manual verification: every state rule targeted
  // `.architecture-node.is-*`, but the classes are written onto React Flow's
  // node object, which puts them on the `.react-flow__node` wrapper. Nothing
  // matched. Hover-reveals-neighbours and dimming had never rendered.

  await t.test("state rules match the wrapper, not the inner node", () => {
    for (const state of ["is-dimmed", "is-neighbor", "is-selected"]) {
      assert.ok(
        new RegExp(`\\.react-flow__node\\.${state}`).test(CSS),
        `${state} must be matched on the wrapper React Flow writes it to`,
      );
      assert.ok(
        !new RegExp(`\\.architecture-node\\.${state}\\b`).test(CSS),
        `${state} written against .architecture-node would never match`,
      );
    }
  });

  await t.test("de-emphasis never removes interactivity", () => {
    // Recession means "less relevant now", not "gone". A person must be able
    // to reach past the current focus without dismissing it first.
    const dimmed = rule(".react-flow__node.is-dimmed .architecture-node");
    assert.ok(
      !/pointer-events:\s*none/.test(dimmed),
      "a receded node must stay clickable",
    );
  });

  await t.test("receded nodes stay visible enough to aim at", () => {
    // At the previous 0.18 a node was effectively invisible, which made
    // "still clickable" a hollow guarantee.
    const dimmed = rule(".react-flow__node.is-dimmed .architecture-node");
    const opacity = Number.parseFloat(dimmed.match(/opacity:\s*([\d.]+)/)![1]);
    assert.ok(
      opacity >= 0.35,
      `receded opacity ${opacity} is too faint to target`,
    );
    assert.ok(opacity < 1, "receded nodes must still read as secondary");
  });

  await t.test("hover and selection share one visual language", () => {
    // They are the same act at different durations. Two vocabularies would
    // mean learning twice what should be learned once.
    //
    // The hover rule uses a grouped, multi-line selector, so it is matched
    // directly rather than through rule().
    const hovered = CSS.match(
      /\.react-flow__node\.is-hovered \.architecture-node\s*\{([^}]*)\}/,
    )?.[1];
    assert.ok(hovered, "a hover-subject rule must exist");
    const selected = rule(".react-flow__node.is-selected .architecture-node");
    const border = (r: string) => r.match(/border-color:\s*([^;]+);/)?.[1].trim();
    assert.ok(border(hovered!), "hover must set a subject border colour");
    assert.equal(
      border(hovered!),
      border(selected),
      "subject border must be identical whether pointed at or held",
    );
  });

  await t.test("selection reveals relations, exactly as hover does", () => {
    // The subject resolves from hover OR selection, so the same relationship
    // set lights up either way.
    assert.match(
      DIAGRAM_CODE,
      /const subjectId\s*=\s*\n?\s*hoveredFileId \?\? selectedFile\?\.id \?\? null/,
      "hover must take precedence, with selection as the standing fallback",
    );
  });

  await t.test("the hovered class is actually assigned", () => {
    // isHovered was previously computed and then discarded.
    assert.match(DIAGRAM_CODE, /isHovered && !isSelected \? "is-hovered" : ""/);
  });

  await t.test("stacking overrides React Flow's inline z-index", () => {
    // React Flow writes `z-index: 0` inline on every wrapper, which outranks
    // any stylesheet rule — without !important a lifted node renders beneath
    // its neighbours and the lift reads as a glitch.
    assert.match(
      rule(".react-flow__node.is-selected"),
      /z-index:\s*4\s*!important/,
    );
    assert.match(
      rule(".react-flow__node.is-hovered"),
      /z-index:\s*4\s*!important/,
    );
  });

  await t.test("relations outrank recession", () => {
    assert.match(DIAGRAM_CODE, /isDimmed && !isNeighbor \? "is-dimmed" : ""/);
  });
});

// ---------------------------------------------------------------------------
// Cross-region navigation
// ---------------------------------------------------------------------------

test("Phase 5 — crossing a region boundary keeps the selection", async (t) => {
  // Found in Phase 5's rendered verification, in the Phase 4 sync effect.
  //
  // Navigation that moves region AND selects in one act — from search, from a
  // boundary stub, from an inspector link — batches setFolder and
  // setSelectedFile into a single update. A blanket "region changed, so clear
  // the selection" then discarded the selection the navigation had just made:
  // the person arrived in the right region with nothing selected and no
  // inspector, having asked for a specific file.

  await t.test("a selection is dropped for belonging elsewhere, not for change", () => {
    // The predicate must test the selection against the region, rather than
    // clearing unconditionally whenever the region differs.
    assert.match(
      DIAGRAM_CODE,
      /setSelectedFile\(\(current\) =>\s*\n?\s*current && folder !== null && current\.folder === folder \? current : null,?\s*\n?\s*\)/,
      "the sync effect must keep a selection that belongs to the new region",
    );
  });

  await t.test("the effect no longer clears selection unconditionally", () => {
    const effect = DIAGRAM_CODE.match(
      /if \(syncedRegion\.current !== folder\) \{[\s\S]*?\n {4}\}/,
    )?.[0];
    assert.ok(effect, "the region-sync branch should exist");
    assert.ok(
      !/setSelectedFile\(null\)/.test(effect!),
      "an unconditional clear would discard cross-boundary navigation",
    );
  });
});

// ---------------------------------------------------------------------------
// Observations became a lens control
// ---------------------------------------------------------------------------

test("Phase 3 — observations are a control, not a surface", async (t) => {
  await t.test("the below-the-fold card grid is gone", () => {
    // Reaching it required scrolling the map out of view — destroying the
    // spatial anchor in order to consult a list about it.
    assert.ok(!/anomaly-card/.test(CSS));
    assert.ok(!/anomaly-card/.test(DIAGRAM_CODE));
    assert.ok(!/className="anomalies"/.test(DIAGRAM_CODE));
  });

  await t.test("lenses live in a popover that collapses", () => {
    assert.match(DIAGRAM, /lensMenuOpen/);
    assert.match(rule(".lens-popover"), /position:\s*absolute/);
  });

  await t.test("all three observation lenses survive", () => {
    for (const mode of ["cycles", "hubs", "orphans"]) {
      assert.ok(
        new RegExp(`mode: "${mode}"`).test(DIAGRAM_CODE),
        `the ${mode} lens must still be reachable`,
      );
    }
  });

  await t.test("observations are framed as measurements, not verdicts", () => {
    // Phase 3 asserted this framing was deliberately UNCHANGED — relocating a
    // control and reframing its language were separate concerns. Phase 6 is
    // the reframe, so the assertion inverts.
    //
    // "God module" and "orphan" name faults, and are frequently wrong about
    // one: a file everything depends on may be excellent design, and a file
    // nothing imports may be an entry point doing exactly its job.
    assert.match(DIAGRAM_CODE, /Most depended upon/);
    assert.match(DIAGRAM_CODE, /Not imported anywhere/);
    assert.match(DIAGRAM_CODE, /Import cycles/);

    for (const verdict of ["Dependency hubs", "Orphans", "God module"]) {
      assert.ok(
        !new RegExp(verdict).test(DIAGRAM_CODE),
        `"${verdict}" states a conclusion the evidence does not support`,
      );
    }
  });

  await t.test("selecting a lens applies it to the map", () => {
    const active = rule(".lens-active-bar");
    assert.match(active, /position:\s*absolute/);
    assert.match(DIAGRAM, /className="lens-active-bar"/);
  });
});
