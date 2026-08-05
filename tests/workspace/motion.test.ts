/**
 * Phase 7 — Motion
 *
 * Three tiers, assigned by the cognitive significance of a change; one easing
 * family; every transition interruptible; `prefers-reduced-motion` honored
 * with orientation preserved by other means.
 *
 * What these tests are actually protecting is the absence of a second source
 * of truth. The failure mode this phase exists to correct was not any single
 * wrong duration — it was eleven durations spread across CSS and JS with no
 * relationship between them, so that two halves of one act could animate at
 * different speeds and nobody could see it from either file alone. Most of the
 * assertions below are therefore about what must NOT be in the source: a
 * literal duration anywhere is the regression, whatever value it holds.
 *
 * @module tests/workspace/motion.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MOTION_EASE_CSS,
  MOTION_FALLBACK_MS,
  MOTION_LEG_FALLBACK_MS,
  cameraMotion,
  motionDuration,
  motionEase,
  structuralLegDuration,
} from "@/lib/workspace/motion";

const read = (...parts: string[]) =>
  readFileSync(path.join(process.cwd(), ...parts), "utf8");

const CSS = read("app", "globals.css");
const DIAGRAM = read("components", "DiagramView.tsx");
const ZOOM = read("components", "ZoomControls.tsx");

/**
 * Source with comments removed.
 *
 * Assertions about what must not appear need to read code, not prose. These
 * files explain at length which durations were removed and why — a comment
 * saying `setTimeout(…, 400)` is the record of a fix, and matching it would
 * make documenting a removal indistinguishable from failing to remove it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const DIAGRAM_CODE = code(DIAGRAM);
const ZOOM_CODE = code(ZOOM);

/* ─── The tiers exist, and are the only ones ─────────────────────────────── */

test("Phase 7 — three tiers are declared as tokens", () => {
  assert.match(CSS, /--motion-immediate:\s*0ms/);
  assert.match(CSS, /--motion-connective:\s*180ms/);
  assert.match(CSS, /--motion-structural:\s*400ms/);
});

test("Phase 7 — the JS fallbacks match the CSS tokens exactly", () => {
  // The module reads the tokens at runtime; these constants apply only where
  // no computed style exists (SSR, tests). If they drift from the stylesheet,
  // the server and the client animate differently.
  for (const [tier, expected] of Object.entries(MOTION_FALLBACK_MS)) {
    const declared = new RegExp(`--motion-${tier}:\\s*(\\d+)ms`).exec(CSS);
    assert.ok(declared, `--motion-${tier} is declared in globals.css`);
    assert.equal(
      Number(declared[1]),
      expected,
      `--motion-${tier} and MOTION_FALLBACK_MS.${tier} must agree`,
    );
  }
});

test("Phase 7 — a structural leg is exactly half a structural change", () => {
  // A region change recedes and then arrives. The pair must cost one
  // structural duration, not two.
  const leg = /--motion-structural-leg:\s*(\d+)ms/.exec(CSS);
  assert.ok(leg);
  assert.equal(Number(leg[1]), MOTION_FALLBACK_MS.structural / 2);
  assert.equal(MOTION_LEG_FALLBACK_MS, MOTION_FALLBACK_MS.structural / 2);
});

test("Phase 7 — the superseded transition tokens are gone", () => {
  // --transition-slow and --ease-spring were both declared and never used;
  // --transition-fast/normal encoded durations that no longer exist. Leaving
  // any of them in place would let a future rule reintroduce a fourth tier
  // without anyone noticing.
  for (const dead of [
    "--transition-fast",
    "--transition-normal",
    "--transition-slow",
    "--ease-spring",
  ]) {
    assert.ok(!CSS.includes(dead), `${dead} should no longer exist`);
  }
});

/* ─── One easing family ──────────────────────────────────────────────────── */

test("Phase 7 — one easing curve, shared by CSS and the camera", () => {
  assert.match(CSS, /--motion-ease:\s*cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/);
  assert.equal(MOTION_EASE_CSS, "cubic-bezier(0.4, 0, 0.2, 1)");

  // No other easing may appear in a transition or animation. `ease` as a bare
  // keyword is what most of the old rules used, and it is a different curve
  // from the token — mixing them is how "one easing family" quietly stops
  // being true.
  const eased = CSS.match(/(?:transition|animation):[^;]+;/g) ?? [];
  for (const rule of eased) {
    if (/\bcubic-bezier\(/.test(rule)) {
      assert.match(rule, /var\(--motion-ease\)/, `raw curve in: ${rule}`);
    }
    assert.ok(
      !/\b(ease-in-out|ease-in|ease-out|linear)\b/.test(rule),
      `non-token easing in: ${rule}`,
    );
    // A bare `ease` keyword, not part of --motion-ease or a longhand.
    assert.ok(
      !/(?:^|[\s,])ease(?=[\s;,])/.test(rule.replace(/var\(--motion-ease\)/g, "")),
      `bare 'ease' keyword in: ${rule}`,
    );
  }
});

test("Phase 7 — the easing function is a well-formed curve", () => {
  assert.equal(motionEase(0), 0);
  assert.equal(motionEase(1), 1);

  // Monotonic: eased progress never goes backwards.
  let previous = 0;
  for (let i = 1; i <= 100; i += 1) {
    const value = motionEase(i / 100);
    assert.ok(value >= previous, `not monotonic at ${i / 100}`);
    assert.ok(value >= 0 && value <= 1, `out of range at ${i / 100}`);
    previous = value;
  }

  // Deceleration: more than half the distance is covered in the first half of
  // the time. This is the property that makes a transition report its outcome
  // early and spend the remainder arriving.
  assert.ok(motionEase(0.5) > 0.5, "curve should decelerate, not accelerate");

  // Out-of-range input is clamped rather than extrapolated.
  assert.equal(motionEase(-1), 0);
  assert.equal(motionEase(2), 1);
});

/* ─── No literal durations survive ───────────────────────────────────────── */

test("Phase 7 — no hardcoded durations remain in the stylesheet", () => {
  const rules = CSS.match(/(?:transition|animation):[^;]+;/g) ?? [];
  for (const rule of rules) {
    assert.ok(
      !/\d+m?s\b/.test(rule),
      `literal duration must come from a token: ${rule}`,
    );
  }
});

test("Phase 7 — no hardcoded camera durations remain in components", () => {
  // Every camera move must be spread from cameraMotion(), which is what pairs
  // a duration with the shared easing. A literal `duration:` is a move that
  // has escaped the system.
  for (const [name, source] of [
    ["DiagramView", DIAGRAM_CODE],
    ["ZoomControls", ZOOM_CODE],
  ] as const) {
    assert.ok(
      !/duration:\s*\d+/.test(source),
      `${name} should route every camera move through cameraMotion()`,
    );
  }
});

test("Phase 7 — every camera move carries the shared easing", () => {
  // setCenter/setViewport/fitView/zoomIn/zoomOut each accept motion options.
  // Counting call sites against cameraMotion() usages catches a new move added
  // without one, which would silently fall back to React Flow's default curve.
  const moves =
    (DIAGRAM_CODE.match(/\.(setCenter|setViewport|fitView|zoomIn|zoomOut)\(/g) ?? []).length +
    (ZOOM_CODE.match(/\b(fitView|zoomIn|zoomOut)\(/g) ?? []).length;
  const motions =
    (DIAGRAM_CODE.match(/cameraMotion\(/g) ?? []).length +
    (ZOOM_CODE.match(/cameraMotion\(/g) ?? []).length;
  assert.equal(moves, motions, "every camera move should use cameraMotion()");
});

/* ─── Interruptibility ───────────────────────────────────────────────────── */

test("Phase 7 — a region change in flight is cancelled by the next one", () => {
  // The specific regression: four separate call sites each started an
  // uncancellable timer, so two quick clicks ran both to completion and the
  // map landed wherever the later callback happened to fire — not necessarily
  // the region most recently asked for.
  assert.match(DIAGRAM, /pendingRegionChange\s*=\s*useRef/);
  assert.match(
    DIAGRAM,
    /clearTimeout\(pendingRegionChange\.current\)/,
    "a pending region change must be cleared before starting another",
  );
});

test("Phase 7 — every region change goes through the one helper", () => {
  // Symmetry between forward and reverse is guaranteed by there being one
  // implementation, not two that currently agree. Drill-in, return to
  // overview, trail jump and popstate must all call changeRegion.
  assert.match(DIAGRAM, /const changeRegion = useCallback/);

  // setFolder is written only inside that helper and the initial state.
  const direct = DIAGRAM.match(/setFolder\(/g) ?? [];
  assert.equal(
    direct.length,
    2,
    "setFolder should be called only from within changeRegion (twice: the " +
      "instant path and the deferred one)",
  );
});

test("Phase 7 — arrival after a region change waits for geometry, not a clock", () => {
  // The old code guessed 400ms for the new region to render, then called
  // getNode and silently did nothing if it was not there yet.
  assert.ok(
    !/setTimeout\([^)]*,\s*\d+\s*\)/.test(DIAGRAM_CODE),
    "no timer may carry a literal duration; the swap point comes from a token",
  );
  assert.match(DIAGRAM, /useNodesInitialized\(\)/);
  assert.match(DIAGRAM, /pendingFocus/);
});

/* ─── Symmetry ───────────────────────────────────────────────────────────── */

test("Phase 7 — the region fade governs both legs", () => {
  // The transition must live on the base rule. Declared only on .is-fading it
  // would animate the departure and snap the arrival — Motion P8's exact
  // prohibition on different visual logic for equivalent forward and reverse
  // transitions.
  const base = /\.map-region\s*\{[^}]*\}/.exec(CSS);
  assert.ok(base, ".map-region base rule exists");
  assert.match(base[0], /transition:\s*opacity\s+var\(--motion-structural-leg\)/);

  const fading = /\.map-region\.is-fading\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(fading);
  assert.ok(
    !/transition/.test(fading[1]),
    ".is-fading must not carry its own transition",
  );
});

test("Phase 7 — back and forward are restored at the tier of the change", () => {
  // A single duration for every popstate was symmetric with neither a region
  // change nor a selection.
  assert.match(DIAGRAM, /crossesRegion/);
  assert.match(
    DIAGRAM,
    /cameraMotion\(crossesRegion \? "structural" : "connective"\)/,
  );
});

test("Phase 7 — closing the inspector reverses the camera offset", () => {
  // Opening shifts the camera right by half the panel width. Closing gave the
  // space back without moving the camera, leaving the subject off-centre in a
  // map that no longer had a panel beside it.
  //
  // The offset is applied to the viewport translation rather than via a
  // re-centre: converting screen to world coordinates needs the map
  // container's geometry, and getting that wrong made the reversal drift
  // vertically by half the rail's height on every close.
  const close = /const closePanel = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/.exec(DIAGRAM_CODE);
  assert.ok(close, "closePanel exists");
  assert.match(close[0], /inspectorWidth\(\)\s*\/\s*2/);
  assert.match(close[0], /cameraMotion\("connective"\)/);

  // y is carried through untouched. A reversal that changes the other axis is
  // not a reversal.
  assert.match(
    close[0],
    /\{\s*x:\s*x\s*\+\s*inspectorWidth\(\)\s*\/\s*2,\s*y,\s*zoom\s*\}/,
    "only x may change when the inspector closes",
  );
  assert.ok(
    !/innerWidth|innerHeight/.test(close[0]),
    "window dimensions are not the map container's dimensions",
  );
});

test("Phase 7 — Escape and the close button dismiss identically", () => {
  // Escape previously called setSelectedFile(null) directly, making it the
  // one dismissal path that skipped the camera return.
  assert.match(
    DIAGRAM,
    /if \(selectedFile\) \{ closePanel\(\); return; \}/,
    "Escape should route through closePanel",
  );
});

/* ─── Restraint ──────────────────────────────────────────────────────────── */

test("Phase 7 — emphasis and recession are immediate", () => {
  // Hover, selection, neighbour warming and lens dimming all reach the node
  // through the same classes. Any transition here would animate feedback,
  // which reads as lag; worse, the old rule animated opacity at 180ms and
  // border at 150ms, so one change arrived in two instalments.
  const node = /^\.architecture-node\s*\{[^}]*\}/m.exec(CSS);
  assert.ok(node, ".architecture-node base rule exists");
  assert.ok(
    !/transition/.test(node[0]),
    "node emphasis must not animate",
  );
});

test("Phase 7 — the arrival pulse is gone entirely", () => {
  // 700ms in CSS, 800ms on the timer that cleared it: one effect, two
  // durations, belonging to no tier — and restating a fact the selection ring
  // already carried permanently.
  assert.ok(!CSS.includes("nodePulse"), "the keyframes should be removed");
  assert.ok(!CSS.includes("is-pulsing"), "the rule should be removed");
  assert.ok(!DIAGRAM.includes("pulsingNodeId"), "the state should be removed");
  assert.ok(!DIAGRAM.includes("is-pulsing"), "the class should not be written");
});

/* ─── Reduced motion ─────────────────────────────────────────────────────── */

test("Phase 7 — reduced motion collapses tiers 2 and 3 to instant", () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(CSS);
  assert.ok(block, "a prefers-reduced-motion block exists");

  assert.match(block[0], /--motion-connective:\s*0ms/);
  assert.match(block[0], /--motion-structural:\s*0ms/);
  assert.match(block[0], /--motion-structural-leg:\s*0ms/);
});

test("Phase 7 — reduced motion stops continuous indicators", () => {
  // A zero-duration infinite animation is degenerate. The honest substitute
  // is a static element that still reads as "not finished yet".
  const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(CSS);
  assert.ok(block);
  for (const loader of [
    ".skeleton-title",
    ".skeleton-node",
    ".progress-pulse",
  ]) {
    assert.ok(block[0].includes(loader), `${loader} should stop animating`);
  }
  assert.match(block[0], /animation:\s*none/);
});

test("Phase 7 — the camera inherits the preference from the same tokens", () => {
  // The point of reading tokens rather than matchMedia: there is no second
  // reduced-motion branch in JS that could disagree with the stylesheet.
  const source = read("lib", "workspace", "motion.ts");
  assert.ok(
    !source.includes("matchMedia"),
    "motion.ts should read tokens, not query the preference separately",
  );
  assert.match(source, /getComputedStyle/);
});

test("Phase 7 — orientation under reduced motion is preserved by other means", () => {
  // Removing motion is only safe because none of these depend on it. If a
  // future change made the trail or the breadcrumb animated-in, this test
  // would still pass — but the map not re-laying-out is the load-bearing one,
  // and that is asserted by the camera-offset model in Phase 3's tests.
  assert.match(DIAGRAM, /className="trail"/);
  assert.match(DIAGRAM, /<BreadcrumbNav/);
  assert.match(DIAGRAM, /className="context-cluster"/);
});

/* ─── The module's own behaviour ─────────────────────────────────────────── */

test("Phase 7 — durations fall back cleanly with no DOM", () => {
  // Node has no window; these are the values SSR and tests see.
  assert.equal(motionDuration("immediate"), 0);
  assert.equal(motionDuration("connective"), MOTION_FALLBACK_MS.connective);
  assert.equal(motionDuration("structural"), MOTION_FALLBACK_MS.structural);
  assert.equal(structuralLegDuration(), MOTION_LEG_FALLBACK_MS);
});

test("Phase 7 — cameraMotion pairs a duration with the shared easing", () => {
  const motion = cameraMotion("connective");
  assert.equal(motion.duration, MOTION_FALLBACK_MS.connective);
  assert.equal(motion.ease, motionEase);
});
