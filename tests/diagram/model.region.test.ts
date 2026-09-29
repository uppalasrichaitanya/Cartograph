import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagramModel, DiagramScopeError, evidenceFor } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import type { DiagramOptions } from "@/lib/diagram/types";
import { makeResult, many } from "./fixtures";

const region = (id: string, over: Partial<DiagramOptions> = {}): DiagramOptions =>
  ({ ...defaultDiagramOptions("document"), scope: { kind: "region", id }, ...over });

test("a region above the file budget shows its most connected files and an overflow tile", () => {
  const result = makeResult({ ...many("big", 30, ["big/f00.ts"]), ...many("big/sub", 10), "big/f00.ts": [] });
  const model = buildDiagramModel(result, region("big"));
  assert.equal(model.units.filter((unit) => unit.kind === "file").length, 31);
  const overflow = model.units.find((unit) => unit.id === "u:#overflow");
  // 40 files, budget 32: the 31 most connected are drawn, 9 fold into the overflow tile.
  assert.equal(overflow?.label, "+ 9 more files");
  assert.equal(model.omitted.files, 9);
  assert.ok(model.units.some((unit) => unit.id === "f:big/f00.ts"));
});

test("imports crossing the region boundary end at boundary units on either side", () => {
  const result = makeResult({
    "api/a.ts": ["core/a.ts"], "api/b.ts": [], "api/c.ts": [],
    "core/a.ts": ["util/a.ts"], "core/b.ts": ["util/a.ts"], "core/c.ts": [],
    "util/a.ts": [], "util/b.ts": [], "util/c.ts": [],
  });
  const model = buildDiagramModel(result, region("core"));
  const incoming = model.units.find((unit) => unit.id === "b:in:api");
  const outgoing = model.units.find((unit) => unit.id === "b:out:util");
  assert.equal(incoming?.side, "in");
  assert.equal(incoming?.files, 3);
  assert.equal(outgoing?.side, "out");
  assert.equal(model.edges.find((edge) => edge.id === "e:b:in:api->f:core/a.ts")?.count, 1);
  assert.equal(model.edges.find((edge) => edge.id === "e:f:core/a.ts->b:out:util")?.count, 1);
});

test("unresolved imports collapse into one unit and are never dropped", () => {
  const result = makeResult({ "core/a.ts": [], "core/b.ts": [], "core/c.ts": [] });
  const evidence = { ...evidenceFor(result), unresolved: new Map([["core/a.ts", 2], ["core/b.ts", 1]]) };
  const model = buildDiagramModel(result, region("core"), evidence);
  const unit = model.units.find((candidate) => candidate.id === "u:#unresolved");
  assert.equal(unit?.label, "3 unresolved imports");
  assert.equal(model.edges.find((edge) => edge.id === "e:f:core/a.ts->u:#unresolved")?.count, 2);
});

test("files in several sub-folders are wrapped in one level of groups", () => {
  const result = makeResult({ ...many("lib/a", 3), ...many("lib/b", 3), "lib/root.ts": [] });
  const model = buildDiagramModel(result, region("lib"));
  assert.deepEqual(model.groups.map((group) => group.id), ["g:lib/a", "g:lib/b"]);
  assert.equal(model.units.find((unit) => unit.id === "f:lib/root.ts")?.groupId, null);
});

test("a region made only of tests still renders its files", () => {
  const result = makeResult({ "tests/a.test.ts": [], "tests/b.test.ts": [], "tests/c.test.ts": [] });
  const model = buildDiagramModel(result, region("tests"));
  assert.equal(model.units.filter((unit) => unit.kind === "file").length, 3);
});

test("an unknown region is a scope error", () => {
  assert.throws(() => buildDiagramModel(makeResult({ "a/1.ts": [] }), region("nope")), DiagramScopeError);
});
