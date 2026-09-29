import assert from "node:assert/strict";
import test from "node:test";
import { layoutDiagram } from "@/lib/diagram/layout";
import { buildDiagramModel } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import type { Box } from "@/lib/diagram/types";
import { webApp } from "./fixtures";

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
