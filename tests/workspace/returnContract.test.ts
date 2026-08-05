/**
 * Phase 4 — The Return Contract
 *
 * Two mechanisms, tested here in isolation because both are pure:
 *
 *   position.ts  every reachable state is addressable, and every address is
 *                validated before it becomes application state
 *   trail.ts     an ordered record of what an investigation examined
 *
 * The URL is parsed from untrusted input — links get hand-edited, truncated,
 * and shared after the repository has moved on — so a large share of these
 * tests are about degrading to a valid position rather than failing.
 *
 * @module tests/workspace/returnContract.test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_POSITION,
  isNavigation,
  parsePosition,
  samePosition,
  serializePosition,
  type WorkspacePosition,
} from "@/lib/workspace/position";
import {
  appendToTrail,
  fileLabel,
  TRAIL_LIMIT,
  type TrailEntry,
} from "@/lib/workspace/trail";

const REGIONS = new Set(["src/core", "src/ui", "lib", "other"]);
const FILES = new Set([
  "src/core/a.ts",
  "src/core/b.ts",
  "src/ui/x.ts",
  "lib/util.ts",
]);

const parse = (query: string) =>
  parsePosition(new URLSearchParams(query), REGIONS, FILES);

// ---------------------------------------------------------------------------
// Round-tripping
// ---------------------------------------------------------------------------

test("Phase 4 — every position survives a round trip", async (t) => {
  const cases: ReadonlyArray<[string, WorkspacePosition]> = [
    ["empty", EMPTY_POSITION],
    ["region only", { ...EMPTY_POSITION, region: "src/core" }],
    [
      "region and file",
      { ...EMPTY_POSITION, region: "src/core", file: "src/core/a.ts" },
    ],
    ["lens only", { ...EMPTY_POSITION, lens: "cycles" }],
    [
      "everything",
      {
        region: "src/ui",
        file: "src/ui/x.ts",
        lens: "hubs",
        camera: { x: 120.5, y: -40.25, zoom: 1.5 },
      },
    ],
  ];

  for (const [name, position] of cases) {
    await t.test(name, () => {
      const restored = parse(serializePosition(position));
      assert.ok(
        samePosition(position, restored),
        `${name} did not survive: ${JSON.stringify(restored)}`,
      );
    });
  }
});

test("Phase 4 — the overview keeps a clean address", async (t) => {
  await t.test("an empty position produces no query string", () => {
    // The plain /repo/:id address must keep meaning what it always meant.
    assert.equal(serializePosition(EMPTY_POSITION), "");
  });

  await t.test("only non-default values are written", () => {
    const query = serializePosition({ ...EMPTY_POSITION, region: "lib" });
    assert.equal(query, "?region=lib");
  });
});

// ---------------------------------------------------------------------------
// Untrusted input
// ---------------------------------------------------------------------------

test("Phase 4 — a malformed address degrades, never breaks", async (t) => {
  await t.test("an unknown region is dropped", () => {
    // The repository may have changed since the link was minted.
    assert.equal(parse("?region=deleted-folder").region, null);
  });

  await t.test("an unknown file is dropped", () => {
    assert.equal(parse("?file=src/core/gone.ts").file, null);
  });

  await t.test("an unknown lens is dropped", () => {
    assert.equal(parse("?lens=nonsense").lens, null);
  });

  await t.test("a lens hidden from the interface still resolves", () => {
    // 'dependencies' is currently unreachable from the UI. A link minted
    // before it was hidden should still land somewhere valid.
    assert.equal(parse("?lens=dependencies").lens, "dependencies");
  });

  await t.test("a malformed camera is dropped whole", () => {
    // A partially-parsed camera would frame the map somewhere nobody chose.
    for (const bad of [
      "?cam=1,2",
      "?cam=1,2,3,4",
      "?cam=a,b,c",
      "?cam=",
      "?cam=1,2,NaN",
    ]) {
      assert.equal(parse(bad).camera, null, `${bad} should yield no camera`);
    }
  });

  await t.test("a non-positive zoom is rejected", () => {
    // Zoom 0 renders nothing and is not recoverable by panning.
    assert.equal(parse("?cam=0,0,0").camera, null);
    assert.equal(parse("?cam=0,0,-1").camera, null);
  });

  await t.test("negative coordinates are legitimate", () => {
    const camera = parse("?cam=-500.5,-200.25,0.5").camera;
    assert.deepEqual(camera, { x: -500.5, y: -200.25, zoom: 0.5 });
  });

  await t.test("a selection outside its region yields", () => {
    // Only reachable from a hand-edited link. The interface cannot render a
    // file selected inside a region that does not contain it, so the weaker
    // claim is dropped rather than showing something incoherent.
    const position = parse("?region=src/ui&file=src/core/a.ts");
    assert.equal(position.region, "src/ui");
    assert.equal(position.file, null);
  });

  await t.test("a file inside its region is kept", () => {
    const position = parse("?region=src/core&file=src/core/a.ts");
    assert.equal(position.region, "src/core");
    assert.equal(position.file, "src/core/a.ts");
  });

  await t.test("the 'other' bucket does not enforce containment", () => {
    // 'other' collects files from unrelated folders, so path prefix says
    // nothing about membership there.
    const position = parse("?region=other&file=lib/util.ts");
    assert.equal(position.file, "lib/util.ts");
  });

  await t.test("absent params yield the empty position", () => {
    assert.ok(samePosition(parse(""), EMPTY_POSITION));
    assert.ok(samePosition(parsePosition(null, REGIONS, FILES), EMPTY_POSITION));
  });
});

// ---------------------------------------------------------------------------
// Navigation vs. framing
// ---------------------------------------------------------------------------

test("Phase 4 — history records steps, not adjustments", async (t) => {
  const base: WorkspacePosition = {
    region: "src/core",
    file: null,
    lens: null,
    camera: { x: 0, y: 0, zoom: 1 },
  };

  await t.test("changing region is navigation", () => {
    assert.ok(isNavigation(base, { ...base, region: "src/ui" }));
  });

  await t.test("changing selection is navigation", () => {
    assert.ok(isNavigation(base, { ...base, file: "src/core/a.ts" }));
  });

  await t.test("changing lens is navigation", () => {
    assert.ok(isNavigation(base, { ...base, lens: "cycles" }));
  });

  await t.test("panning and zooming is not navigation", () => {
    // Adjusting your view of the step you are already on. Recording it would
    // fill history with camera nudges and make the back button useless.
    assert.ok(
      !isNavigation(base, { ...base, camera: { x: 900, y: 40, zoom: 2 } }),
    );
  });

  await t.test("sub-pixel drift is not a move", () => {
    // A camera that merely settled must not register as a change.
    const drifted: WorkspacePosition = {
      ...base,
      camera: { x: 0.001, y: 0.002, zoom: 1.0001 },
    };
    assert.ok(samePosition(base, drifted));
  });

  await t.test("a real camera change is a change", () => {
    assert.ok(!samePosition(base, { ...base, camera: { x: 50, y: 0, zoom: 1 } }));
  });
});

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

const entry = (id: string, kind: TrailEntry["kind"] = "file"): TrailEntry => ({
  id,
  kind,
  label: kind === "file" ? fileLabel(id) : id,
});

test("Phase 4 — the trail records what was examined", async (t) => {
  await t.test("entries accumulate in order", () => {
    let trail: ReadonlyArray<TrailEntry> = [];
    trail = appendToTrail(trail, entry("src/core", "region"));
    trail = appendToTrail(trail, entry("src/core/a.ts"));
    trail = appendToTrail(trail, entry("src/core/b.ts"));
    assert.deepEqual(trail.map((e) => e.id), [
      "src/core",
      "src/core/a.ts",
      "src/core/b.ts",
    ]);
  });

  await t.test("re-examining the current entry is not a new step", () => {
    // Selecting the same file twice is one act of attention.
    let trail: ReadonlyArray<TrailEntry> = [];
    trail = appendToTrail(trail, entry("src/core/a.ts"));
    const before = trail;
    trail = appendToTrail(trail, entry("src/core/a.ts"));
    assert.equal(trail, before, "the array should not even be rebuilt");
    assert.equal(trail.length, 1);
  });

  await t.test("revisiting an earlier entry moves it to the end", () => {
    // The trail reads as the order in which things last mattered.
    let trail: ReadonlyArray<TrailEntry> = [];
    trail = appendToTrail(trail, entry("src/core/a.ts"));
    trail = appendToTrail(trail, entry("src/core/b.ts"));
    trail = appendToTrail(trail, entry("src/core/a.ts"));
    assert.deepEqual(trail.map((e) => e.id), [
      "src/core/b.ts",
      "src/core/a.ts",
    ]);
  });

  await t.test("a region and a file with the same id stay distinct", () => {
    let trail: ReadonlyArray<TrailEntry> = [];
    trail = appendToTrail(trail, entry("lib", "region"));
    trail = appendToTrail(trail, entry("lib", "file"));
    assert.equal(trail.length, 2);
  });

  await t.test("the oldest entries are dropped at the limit", () => {
    let trail: ReadonlyArray<TrailEntry> = [];
    for (let i = 0; i < TRAIL_LIMIT + 5; i++) {
      trail = appendToTrail(trail, entry(`f${i}.ts`));
    }
    assert.equal(trail.length, TRAIL_LIMIT);
    assert.equal(trail[0].id, "f5.ts", "oldest entries should fall off");
    assert.equal(trail[trail.length - 1].id, `f${TRAIL_LIMIT + 4}.ts`);
  });

  await t.test("appending never mutates the input", () => {
    const original: ReadonlyArray<TrailEntry> = [entry("src/core/a.ts")];
    const snapshot = [...original];
    appendToTrail(original, entry("src/core/b.ts"));
    assert.deepEqual(original, snapshot);
  });

  await t.test("file labels are basenames", () => {
    assert.equal(fileLabel("lib/analysis/ir/builder.ts"), "builder.ts");
    assert.equal(fileLabel("index.ts"), "index.ts");
  });
});
