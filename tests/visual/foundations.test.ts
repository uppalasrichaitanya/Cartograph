/**
 * Phase 8 — Visual Foundations
 *
 * One palette, one type scale, one spacing rhythm, two radii, three
 * elevations — and each colour carrying exactly one meaning.
 *
 * What these tests protect is not any particular value. It is the PROPERTY
 * that the system has a single source for each decision. The failure this
 * phase corrected was not an ugly colour; it was 62 hex literals, 32 font
 * sizes, 17 radii and 14 inline shadows with no rule governing which meant
 * what — a system in which no visual difference could be trusted to signify
 * anything. Most assertions below therefore check for the ABSENCE of ad-hoc
 * values, because a literal reintroduced anywhere is the regression.
 *
 * The contrast test is the one that matters most. Perceptual honesty is not
 * achievable if text cannot be read, and "it looks fine on my monitor" is not
 * a measurement.
 *
 * @module tests/visual/foundations.test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (...parts: string[]) =>
  readFileSync(path.join(process.cwd(), ...parts), "utf8");

const CSS = read("app", "globals.css");
const LAYOUT = read("app", "layout.tsx");
const PAGE = read("app", "page.tsx");
const ICONS = read("components", "Icons.tsx");

/** The token block only — where literals are legitimate. */
const TOKENS = CSS.slice(0, CSS.indexOf("* { box-sizing: border-box; }"));
/** The rules — where they are not. */
const RULES = CSS.slice(CSS.indexOf("* { box-sizing: border-box; }"));

/** Resolve a custom property to its declared value. */
function token(name: string): string {
  const value = TOKENS.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  assert.ok(value, `${name} should be declared in :root`);
  return value!.trim();
}

/* ─── Colour ─────────────────────────────────────────────────────────────── */

test("Phase 8 — the palette is a fixed set of semantic tokens", () => {
  // Ground, ink, hairline, and five semantic hues. Every one has a stated
  // meaning in the file's header comment; none is "a nice blue".
  for (const name of [
    "--paper", "--surface", "--well",
    "--ink", "--ink-muted", "--ink-faint",
    "--rule", "--rule-strong",
    "--focus", "--focus-deep", "--focus-wash",
    "--forest", "--forest-wash",
    "--amber", "--amber-wash",
    "--assisted", "--assisted-wash",
    "--danger", "--danger-wash",
  ]) {
    assert.match(token(name), /^#[0-9A-Fa-f]{6}$/, `${name} should be a hex colour`);
  }
});

test("Phase 8 — the ground is warm, not grey or white", () => {
  // Ivory is the stock a survey is printed on, and it is what makes charcoal
  // read as ink. A neutral or cool ground would make the whole palette a
  // generic light theme.
  const hex = (t: string) => {
    const c = token(t).slice(1);
    return [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
  };
  for (const ground of ["--paper", "--surface", "--well"]) {
    const [r, , b] = hex(ground);
    assert.ok(r > b, `${ground} must be warm (red channel above blue)`);
  }
  // And not pure white, or a surface could not sit visibly ON the ground.
  assert.notEqual(token("--paper").toUpperCase(), "#FFFFFF");
  assert.notEqual(token("--surface").toUpperCase(), "#FFFFFF");
});

test("Phase 8 — every ink reads at AA on every ground", () => {
  // WCAG 2.1 relative luminance and contrast ratio.
  const luminance = (hex: string): number => {
    const c = hex.replace("#", "");
    const channels = [0, 2, 4]
      .map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const inks = [
    "--ink", "--ink-muted", "--ink-faint",
    "--focus", "--focus-deep",
    "--forest", "--amber", "--assisted", "--danger",
  ];
  const grounds = ["--paper", "--surface", "--well"];

  for (const ink of inks) {
    for (const ground of grounds) {
      const r = ratio(token(ink), token(ground));
      assert.ok(
        r >= 4.5,
        `${ink} on ${ground} is ${r.toFixed(2)}:1 — below AA (4.5:1)`,
      );
    }
  }

  // Each wash must also carry its own ink.
  for (const [ink, wash] of [
    ["--focus-deep", "--focus-wash"],
    ["--forest", "--forest-wash"],
    ["--amber", "--amber-wash"],
    ["--assisted", "--assisted-wash"],
    ["--danger", "--danger-wash"],
  ]) {
    const r = ratio(token(ink), token(wash));
    assert.ok(r >= 4.5, `${ink} on ${wash} is ${r.toFixed(2)}:1 — below AA`);
  }
});

test("Phase 8 — selection and failure cannot be confused", () => {
  // The palette's one genuine hazard: rust and red are both warm. They must
  // separate on lightness as well as hue, so the distinction survives
  // greyscale and colour-vision deficiency.
  const luminance = (hex: string): number => {
    const c = hex.replace("#", "");
    const channels = [0, 2, 4]
      .map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const focus = luminance(token("--focus"));
  const danger = luminance(token("--danger"));
  assert.ok(
    focus / danger >= 1.25,
    "rust and red must differ in lightness, not only hue",
  );
});

test("Phase 8 — semantic colours are not used decoratively", () => {
  // Forest, amber and purple each answer one question. If a hue appears in
  // more than a handful of rules it has stopped being semantic and become a
  // palette colour — at which point it teaches nothing.
  for (const [name, cap] of [["--forest", 4], ["--amber", 5], ["--assisted", 4]] as const) {
    const uses = RULES.match(new RegExp(`var\\(${name}\\)`, "g"))?.length ?? 0;
    assert.ok(uses > 0, `${name} should actually be used`);
    assert.ok(
      uses <= cap,
      `${name} is used ${uses} times — spent too widely to stay semantic`,
    );
  }
});

test("Phase 8 — amber never reaches the observations menu", () => {
  // Phase 6 (approved) established that colouring an observation as a fault
  // "states a conclusion the measurement does not". A cycle may be entirely
  // deliberate. Amber marks it where a person is inspecting one file; it does
  // not label the lens list as a fault list.
  const lensRules = RULES.match(/\.lens-[a-z-]+[^{]*\{[^}]*\}/g)?.join("\n") ?? "";
  assert.ok(lensRules.length > 0, "lens styling should exist to check");
  assert.ok(
    !lensRules.includes("--amber"),
    "the observations menu must not be coloured as an alarm",
  );
});

test("Phase 8 — no ad-hoc colour survives in the rules", () => {
  // Colour literals belong in the token block. Two exceptions are declared
  // and justified in the file: the pulse keyframes, which need rgba stops of
  // the accent that cannot reference a hex token, and the modal veils.
  const literals = RULES.match(/#[0-9A-Fa-f]{3,6}\b/g) ?? [];
  const allowed = new Set(["#7A1A1A"]); // the danger button's pressed state
  const unexpected = literals.filter((l) => !allowed.has(l.toUpperCase()));
  assert.deepEqual(
    unexpected,
    [],
    `hex literals must come from tokens: ${unexpected.join(", ")}`,
  );
});

/* ─── Type ───────────────────────────────────────────────────────────────── */

test("Phase 8 — two typefaces, loaded and self-hosted", () => {
  assert.match(LAYOUT, /IBM_Plex_Sans/);
  assert.match(LAYOUT, /IBM_Plex_Mono/);
  assert.match(LAYOUT, /next\/font\/google/);
  // Arial was not merely a default; it cannot disambiguate 0/O or 1/l/I,
  // which is disqualifying for a product whose primary content is paths.
  assert.ok(!CSS.includes("Arial"), "Arial should be gone");
  assert.ok(!CSS.includes("Helvetica"), "the Helvetica fallback should be gone");
});

test("Phase 8 — the scale is six sizes and every rule uses one", () => {
  for (const step of [
    "--text-display", "--text-title", "--text-body",
    "--text-small", "--text-caption", "--text-micro",
  ]) {
    assert.ok(token(step).length > 0);
  }

  // No rule may declare its own size. The previous 32 sizes made the scale
  // meaningless: .82rem and .84rem cannot be told apart, so the difference
  // taught nothing.
  //
  // `inherit` is not a size — it is a rule declining to set one, which is the
  // stricter behaviour: the element takes whatever scale step its parent was
  // given and cannot drift from it.
  const declared = RULES.match(/font-size:\s*([^;]+);/g) ?? [];
  const offenders = declared.filter(
    (d) => !/var\(--text-/.test(d) && !/font-size:\s*inherit/.test(d),
  );
  // The specimen figure sets px sizes inside an SVG, where rem does not scale
  // with the viewBox — declared and justified in the stylesheet.
  const inSvg = offenders.filter((d) => /\d+px/.test(d));
  const rest = offenders.filter((d) => !/\d+px/.test(d));
  assert.deepEqual(rest, [], `font-size must use a scale token: ${rest.join(" ")}`);
  assert.ok(inSvg.length <= 7, "only the specimen figure may use px sizes");
});

test("Phase 8 — paths are always monospaced", () => {
  // A path is compared character by character. Set proportionally, that
  // comparison stops being possible.
  for (const selector of [
    "\\.detail-panel h2",
    "\\.search-result-path",
    "\\.breadcrumb-nav",
    "\\.trail-step",
    "\\.context-region",
  ]) {
    const rule = RULES.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `expected a rule for ${selector}`);
    assert.match(
      rule!,
      /font-family:\s*(var\(--type-mono\)|inherit)/,
      `${selector} carries path text and must be monospaced`,
    );
  }
});

/* ─── Spacing, radius, elevation ─────────────────────────────────────────── */

test("Phase 8 — spacing is one ramp", () => {
  for (let i = 1; i <= 8; i += 1) assert.ok(token(`--space-${i}`).length > 0);
});

test("Phase 8 — two radii, plus a named pill", () => {
  assert.ok(token("--radius-control").length > 0);
  assert.ok(token("--radius-plate").length > 0);
  assert.ok(token("--radius-pill").length > 0);

  // RC1 had thirteen. A radius that varies without meaning is noise, and at
  // this scale the eye reads a 7px and a 9px corner as an inconsistency
  // rather than as a distinction.
  const declared = RULES.match(/border-radius:\s*([^;]+);/g) ?? [];
  const offenders = declared.filter(
    (d) => !/var\(--radius-/.test(d) && !/border-radius:\s*(0|1px|2px|3px|inherit)/.test(d),
  );
  assert.deepEqual(
    offenders,
    [],
    `radius must use a token: ${offenders.join(" ")}`,
  );
});

test("Phase 8 — three elevations, and no inline shadows", () => {
  for (const level of ["--shadow-flat", "--shadow-raised", "--shadow-over"]) {
    assert.ok(token(level).length > 0);
  }

  // Elevation is structural: a surface is higher because it is a different
  // KIND of thing. Fourteen inline literals could not express that.
  const declared = RULES.match(/box-shadow:\s*([^;]+);/g) ?? [];
  const offenders = declared.filter(
    (d) =>
      !/var\(--shadow-/.test(d) &&
      !/box-shadow:\s*none/.test(d) &&
      !/inset/.test(d) &&      // the boundary stub's recess
      !/rgba\(168, 74, 38/.test(d) && // the progress pulse's accent ring
      !/var\(--focus\)/.test(d),      // the selection ring
  );
  assert.deepEqual(
    offenders,
    [],
    `shadows must use an elevation token: ${offenders.join(" ")}`,
  );
});

test("Phase 8 — shadows are cast in the ink's own hue", () => {
  // A neutral shadow on a warm ground reads as a second light source and
  // makes the surface look composited.
  for (const level of ["--shadow-flat", "--shadow-raised", "--shadow-over"]) {
    const value = token(level);
    const stops = value.match(/rgba\((\d+), (\d+), (\d+)/g) ?? [];
    assert.ok(stops.length > 0, `${level} should use rgba stops`);
    for (const stop of stops) {
      const [r, , b] = stop.match(/\d+/g)!.map(Number);
      assert.ok(r > b, `${level} must be warm-cast, not neutral`);
    }
  }
});

/* ─── Iconography ────────────────────────────────────────────────────────── */

test("Phase 8 — the glyph set is one coherent system", () => {
  // Six Unicode characters from four unrelated systems, replaced by one set
  // drawn on a shared grid. A Mac command key rendered on a web app was the
  // clearest symptom: it was available in a font, not chosen.
  for (const glyph of ["⌘", "⌕", "⊡"]) {
    assert.ok(!ICONS.includes(`>${glyph}<`), `${glyph} should not be rendered`);
  }
  assert.match(ICONS, /viewBox="0 0 16 16"/);
  assert.match(ICONS, /stroke="currentColor"/);
  // Every icon sits inside a control that already has an accessible name.
  assert.match(ICONS, /aria-hidden="true"/);

  for (const component of [
    "MarkIcon", "SearchIcon", "FitIcon",
    "ZoomInIcon", "ZoomOutIcon", "CloseIcon",
  ]) {
    assert.ok(ICONS.includes(`export function ${component}`), `${component} should exist`);
  }
});

test("Phase 8 — no Unicode glyph is used as an icon anywhere", () => {
  for (const file of ["DiagramView", "FileDetailPanel", "SearchOverlay", "ZoomControls"]) {
    const source = read("components", `${file}.tsx`);
    // Stripped of comments: the icon module's own docstring names the glyphs
    // it replaced, and recording a removal must not read as failing to remove.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const glyph of ["⌘", "⌕", "⊡", "×"]) {
      assert.ok(
        !code.includes(`>${glyph}<`),
        `${file} should not render ${glyph} as an icon`,
      );
    }
  }
});

/* ─── The landing page ───────────────────────────────────────────────────── */

test("Phase 8 — the showcase asserts nothing it cannot support", () => {
  // A screenshot of an impressive graph would be a picture of an analysis
  // nobody can verify — the exact unearned authority the product exists to
  // avoid. The specimen teaches the notation instead, which is honest and is
  // what a first-time reader actually needs.
  assert.match(PAGE, /SpecimenPlate/);
  const specimen = read("components", "SpecimenPlate.tsx");
  assert.match(specimen, /role="img"/);
  assert.match(specimen, /aria-label=/);
  // It must show the reduced-confidence states, not only the happy path.
  assert.match(specimen, /partial read/);
  assert.match(specimen, /unresolved/);
});

test("Phase 8 — the landing copy matches what the product does", () => {
  // "Useful warnings" described behaviour Phase 6 removed: cycles, hubs and
  // unimported files are no longer framed as faults. A page promising
  // warnings was advertising a product that no longer existed.
  assert.ok(!PAGE.includes("Useful warnings"), "stale warnings framing should be gone");
  assert.ok(!PAGE.includes("God module"), "pejorative framing should be gone");
  assert.ok(!/\bOrphans\b/.test(PAGE), "pejorative framing should be gone");
});

test("Phase 8 — decorative gradients are gone from the page ground", () => {
  // Two radial blooms over the whole sheet: atmosphere with no meaning
  // attached, spending the reader's first impression on nothing.
  const shell = RULES.match(/\.landing-shell\s*\{([^}]*)\}/)?.[1];
  assert.ok(shell);
  assert.ok(
    !/radial-gradient/.test(shell!),
    "the page ground should be the paper token alone",
  );
});

test("Phase 8 — selection is never claimed by a node that has no file", () => {
  // Found in Phase 8's rendered verification, and a genuine logic defect
  // rather than a styling one.
  //
  // `selectedFile?.id === node.data.filePath` evaluates to
  // `undefined === undefined` for every node carrying no filePath — all
  // folder nodes and all boundary stubs — so with nothing selected, every one
  // of them was marked `is-selected`. Two collapsed-region stubs were wearing
  // the full selection treatment on a view where no file had been chosen.
  //
  // It survived earlier phases because the old accent was a muted blue close
  // to the resting border colour. Rust made it unmissable — which is the case
  // for a palette where one colour means exactly one thing: a colour used in
  // a single role makes its own misuse visible.
  const source = read("components", "DiagramView.tsx");
  const guarded = /const isSelected\s*=\s*selectedFile\s*!=\s*null\s*&&/.test(source);
  assert.ok(
    guarded,
    "isSelected must first establish that anything is selected at all",
  );
  assert.ok(
    !/const isSelected = selectedFile\?\.id === node\.id \|\| selectedFile\?\.id === node\.data\.filePath;/.test(source),
    "the unguarded optional-chaining comparison must not return",
  );
});

test("Phase 8 — surfaces that float carry the stronger hairline", () => {
  // Found in Phase 8's rendered verification. On the previous cool-grey
  // ground a soft cast shadow was enough to separate the inspector from the
  // map. On ivory it is not: warm-on-warm gives the shadow very little to
  // register against, and the panel lost its edge.
  //
  // So on this palette elevation is led by the border and supported by the
  // shadow, not the other way round. Every surface using --shadow-over is
  // genuinely above the page and must take --rule-strong; a plain --rule
  // there would leave it floating without an edge.
  for (const selector of [
    "\\.detail-panel",
    "\\.lens-popover",
    "\\.confirm-dialog",
    "\\.search-card",
  ]) {
    const rule = RULES.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `expected a rule for ${selector}`);
    assert.match(
      rule!,
      /box-shadow:\s*var\(--shadow-over\)/,
      `${selector} should be an over-surface`,
    );
    assert.match(
      rule!,
      /border:\s*1px solid var\(--rule-strong\)/,
      `${selector} floats, so its edge must be the stronger hairline`,
    );
  }
});

/* ─── Earlier phases still hold ──────────────────────────────────────────── */

test("Phase 8 — the confidence encoding survives the restyle", () => {
  // Phase 1's channels are form and ink, never hue — so a repalette must not
  // be able to weaken them. Re-asserted here because this is the phase most
  // likely to have quietly traded a border style for a colour.
  const heuristic = RULES.match(/\.architecture-node\.confidence-heuristic\s*\{([^}]*)\}/)?.[1];
  assert.ok(heuristic);
  assert.match(heuristic!, /border-style:\s*dashed/);

  const unknown = RULES.match(/\.architecture-node\.confidence-unknown\s*\{([^}]*)\}/)?.[1];
  assert.ok(unknown);
  assert.match(unknown!, /border-style:\s*dashed/);
  assert.match(unknown!, /border-right:\s*none/);

  // And verified still has no treatment of its own.
  assert.ok(
    !/\.confidence-verified\b/.test(CSS),
    "verified must remain unmarked",
  );
});

test("Phase 8 — generated reasoning stays unmistakable", () => {
  // Four channels: the only cool hue in a warm palette, its own wash, a left
  // rule where facts have full borders, and a serif italic face. The serif is
  // a deliberate exception to "two typefaces" — the two-face rule governs
  // Cartograph's own voice, and this is quoted material from another source.
  const note = RULES.match(/\.assisted-note\s*\{([^}]*)\}/)?.[1];
  assert.ok(note);
  assert.match(note!, /border-left/);
  assert.match(note!, /var\(--assisted/);

  const body = RULES.match(/\.assisted-note p\s*\{([^}]*)\}/)?.[1];
  assert.ok(body);
  assert.match(body!, /font-style:\s*italic/);
  assert.match(body!, /serif/);
});
