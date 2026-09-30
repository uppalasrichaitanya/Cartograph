/**
 * routedEdgePath: the ELK route, re-anchored to where React Flow says the
 * handles are, or null when the route no longer describes the edge.
 *
 * @module tests/workspace/routedPath.test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { routedEdgePath } from "@/lib/workspace/routedPath";

/** Every M/L/Q coordinate pair in a path, in order. */
function coords(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const route = [
  { x: 0, y: 10 },
  { x: 50, y: 10 },
  { x: 50, y: 90 },
  { x: 100, y: 90 },
];

test("returns null for a route with fewer than two points", () => {
  assert.equal(routedEdgePath([], { x: 0, y: 0 }, { x: 10, y: 10 }), null);
  assert.equal(routedEdgePath([{ x: 0, y: 0 }], { x: 0, y: 0 }, { x: 10, y: 10 }), null);
});

test("returns null when a handle is more than 8px from the route end", () => {
  assert.equal(routedEdgePath(route, { x: 0, y: 30 }, { x: 100, y: 90 }), null, "source moved");
  assert.equal(routedEdgePath(route, { x: 0, y: 10 }, { x: 140, y: 90 }), null, "target moved");
});

test("an exact match draws the route with rounded corners", () => {
  const d = routedEdgePath(route, { x: 0, y: 10 }, { x: 100, y: 90 });
  assert.equal(d, "M0 10L42 10Q50 10 50 18L50 82Q50 90 58 90L100 90");
});

test("endpoints snap to the handles and every segment stays axis-aligned", () => {
  // Handles sit a few px off the ELK end points.
  const d = routedEdgePath(route, { x: -2.5, y: 13 }, { x: 102.5, y: 87 }, 0)!;
  assert.ok(d);
  const points = coords(d);
  assert.deepEqual(points[0], [-2.5, 13]);
  assert.deepEqual(points[points.length - 1], [102.5, 87]);
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    assert.ok(a[0] === b[0] || a[1] === b[1], `segment ${i} is diagonal: ${a} -> ${b}`);
  }
});

test("the corner radius is clamped to half of the shorter adjacent segment", () => {
  const short = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 100 },
    { x: 20, y: 100 },
  ];
  // First and last legs are 10px long, so the radius (8) clamps to 5.
  const d = routedEdgePath(short, { x: 0, y: 0 }, { x: 20, y: 100 })!;
  assert.equal(d, "M0 0L5 0Q10 0 10 5L10 95Q10 100 15 100L20 100");
});

test("collinear points are dropped", () => {
  const withMid = [
    { x: 0, y: 10 },
    { x: 25, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 90 },
    { x: 100, y: 90 },
  ];
  const d = routedEdgePath(withMid, { x: 0, y: 10 }, { x: 100, y: 90 });
  assert.equal(d, "M0 10L42 10Q50 10 50 18L50 82Q50 90 58 90L100 90");
});

test("a straight two-point route whose handles differ in y gets a vertical jog", () => {
  const d = routedEdgePath([{ x: 0, y: 10 }, { x: 100, y: 10 }], { x: 0, y: 10 }, { x: 100, y: 14 }, 0)!;
  const points = coords(d);
  for (let i = 1; i < points.length; i += 1) {
    assert.ok(points[i - 1][0] === points[i][0] || points[i - 1][1] === points[i][1]);
  }
});

function assertAxisAligned(d: string) {
  const points = coords(d);
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    assert.ok(a[0] === b[0] || a[1] === b[1], `diagonal segment ${a} -> ${b} in ${d}`);
  }
}

test("duplicate leading points do not leave a diagonal first segment", () => {
  const d = routedEdgePath(
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }],
    { x: 0, y: 1 },
    { x: 100, y: 50 },
  )!;
  assert.ok(d);
  assertAxisAligned(d);
});

test("a collinear 3-point route with both ends moved stays axis-aligned", () => {
  const d = routedEdgePath(
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    { x: 0, y: 2 },
    { x: 100, y: 0 },
  )!;
  assert.ok(d);
  assertAxisAligned(d);
  assert.deepEqual(coords(d)[0], [0, 2]);
});

test("a route whose first segment is vertical follows the source x", () => {
  const d = routedEdgePath(
    [{ x: 10, y: 0 }, { x: 10, y: 40 }, { x: 90, y: 40 }],
    { x: 12, y: 0 },
    { x: 90, y: 40 },
    0,
  )!;
  assertAxisAligned(d);
  assert.equal(d, "M12 0L12 40L90 40");
});

test("a vertical two-point route with misaligned handles gets a jog", () => {
  const d = routedEdgePath([{ x: 10, y: 0 }, { x: 10, y: 100 }], { x: 10, y: 0 }, { x: 14, y: 100 })!;
  assertAxisAligned(d);
});

test("a back-edge loop keeps its shape with snapped ends and the default radius", () => {
  const loop = [
    { x: 200, y: 50 },
    { x: 220, y: 50 },
    { x: 220, y: 150 },
    { x: -20, y: 150 },
    { x: -20, y: 50 },
    { x: 0, y: 50 },
  ];
  const d = routedEdgePath(loop, { x: 199.5, y: 50 }, { x: 0.5, y: 50 })!;
  assert.ok(d);
  assertAxisAligned(routedEdgePath(loop, { x: 199.5, y: 50 }, { x: 0.5, y: 50 }, 0)!);
  assert.deepEqual(coords(d)[0], [199.5, 50]);
  assert.deepEqual(coords(d).at(-1), [0.5, 50]);
  assert.ok(d.includes("Q"), "corners are rounded");
});

test("anchored ends: handle plus port offset is what gets compared and snapped", () => {
  // The route ends sit 14px below / 10px above the handles' height.
  const anchored = [
    { x: 0, y: 24 },
    { x: 50, y: 24 },
    { x: 50, y: 80 },
    { x: 100, y: 80 },
  ];
  const [source, target] = [{ x: 0, y: 10 + 14 }, { x: 100, y: 90 - 10 }];
  assert.ok(routedEdgePath(anchored, source, target));
  // Ignoring the offsets, the handles are too far from the ends: stale.
  assert.equal(routedEdgePath(anchored, { x: 0, y: 10 }, { x: 100, y: 90 }), null);
});
