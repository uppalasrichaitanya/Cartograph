import assert from "node:assert/strict";
import test from "node:test";
import { gridFallback, layoutDiagram } from "@/lib/diagram/layout";
import { buildDiagramModel } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import type { Box } from "@/lib/diagram/types";
import { makeResult, many, webApp } from "./fixtures";

const options = defaultDiagramOptions("document");
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

test("layout is deterministic", async () => {
  const model = buildDiagramModel(webApp(), options);
  assert.deepEqual(await layoutDiagram(model, options), await layoutDiagram(model, options));
});

test("units never overlap and sit inside their groups and the canvas", async () => {
  const model = buildDiagramModel(webApp(), options);
  const positioned = await layoutDiagram(model, options);
  const boxes = [...positioned.units.entries()];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(!overlaps(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`);
    }
  }
  for (const unit of model.units) {
    const box = positioned.units.get(unit.id)!;
    assert.ok(inside(box, { x: 0, y: 0, width: positioned.width, height: positioned.height }), unit.id);
    if (unit.groupId) assert.ok(inside(box, positioned.groups.get(unit.groupId)!), `${unit.id} outside ${unit.groupId}`);
  }
});

test("every edge starts near its source box and ends near its target box", async () => {
  const model = buildDiagramModel(webApp(), options);
  const positioned = await layoutDiagram(model, options);
  const near = (point: { x: number; y: number }, box: Box) =>
    point.x >= box.x - 2 && point.x <= box.x + box.width + 2 && point.y >= box.y - 2 && point.y <= box.y + box.height + 2;
  for (const { edge, points } of positioned.edges) {
    assert.ok(near(points[0], positioned.units.get(edge.from)!), `${edge.id} start`);
    assert.ok(near(points[points.length - 1], positioned.units.get(edge.to)!), `${edge.id} end`);
  }
});

test("the caption row is reserved from options alone", async () => {
  const model = buildDiagramModel(webApp(), options);
  const plain = await layoutDiagram(model, options);
  const withAi = await layoutDiagram(model, { ...options, annotations: "measured+ai" });
  assert.equal(withAi.reserveCaption, true);
  assert.equal(plain.reserveCaption, false);
  const id = model.units[0].id;
  assert.ok(withAi.units.get(id)!.height > plain.units.get(id)!.height);
});

/** A repository with groups, cross-group edges, and more than ten units. */
function bigApp() {
  return makeResult({
    ...many("app", 3, ["components/f00.ts", "lib/api/f00.ts", "lib/ai/f00.ts"]),
    ...many("components", 4, ["lib/api/f01.ts", "lib/ai/f01.ts"]),
    ...many("lib/api", 6, ["lib/db/f00.ts", "lib/auth/f00.ts"]),
    ...many("lib/ai", 6, ["lib/db/f01.ts", "lib/api/f02.ts"]),
    ...many("lib/db", 5, ["lib/auth/f01.ts"]),
    ...many("lib/auth", 5),
    ...many("lib/cache", 4, ["lib/db/f03.ts"]),
    ...many("lib/queue", 4, ["lib/cache/f00.ts", "lib/ai/f03.ts"]),
    ...many("lib/log", 3),
    ...many("jobs", 4, ["lib/db/f02.ts", "lib/ai/f02.ts", "app/f00.ts"]),
    ...many("scripts", 3, ["jobs/f00.ts", "lib/auth/f02.ts", "lib/queue/f01.ts"]),
  });
}

/** True when an axis-aligned segment crosses the interior of the box (shrunk by 2 px). */
function crosses(a: { x: number; y: number }, b: { x: number; y: number }, box: Box): boolean {
  const x0 = box.x + 2;
  const y0 = box.y + 2;
  const x1 = box.x + box.width - 2;
  const y1 = box.y + box.height - 2;
  if (Math.abs(a.x - b.x) < 0.01) return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  if (Math.abs(a.y - b.y) < 0.01) return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  // A diagonal segment should not occur; test its bounding box conservatively.
  return Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
}

for (const [name, build] of [["webApp", webApp], ["a larger grouped repository", bigApp]] as const) {
  test(`no arrow passes through a box that is not its own endpoint (${name})`, async () => {
    const model = buildDiagramModel(build(), options);
    if (name !== "webApp") {
      assert.ok(model.units.length >= 10, `only ${model.units.length} units`);
      assert.ok(model.groups.length >= 1);
    }
    const positioned = await layoutDiagram(model, options);
    assert.ok(positioned.edges.length > 0);
    for (const { edge, points, curved } of positioned.edges) {
      assert.equal(curved, false);
      for (let i = 0; i + 1 < points.length; i += 1) {
        for (const [id, box] of positioned.units) {
          if (id === edge.from || id === edge.to) continue;
          assert.ok(!crosses(points[i], points[i + 1], box), `${edge.id} passes through ${id}`);
        }
      }
    }
  });
}

test("an empty figure has a finite canvas, from ELK and from the grid fallback", async () => {
  const model = { ...buildDiagramModel(webApp(), options), units: [], groups: [], edges: [] };
  const laid = await layoutDiagram(model, options);
  assert.ok(Number.isFinite(laid.width) && Number.isFinite(laid.height) && laid.width >= 40 && laid.height >= 40);
  const grid = gridFallback(model, new Map(), false);
  assert.ok(Number.isFinite(grid.width) && Number.isFinite(grid.height) && grid.width >= 40 && grid.height >= 40);
});
