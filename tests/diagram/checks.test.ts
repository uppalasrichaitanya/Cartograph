import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagramModel, evidenceFor } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import { loop, makeResult, many } from "./fixtures";

const overview = { ...defaultDiagramOptions("document"), detail: "overview" as const };
const kinds = (spec: Parameters<typeof makeResult>[0], options = overview, unresolved?: Map<string, number>) => {
  const result = makeResult(spec);
  const evidence = unresolved ? { ...evidenceFor(result), unresolved } : evidenceFor(result);
  return buildDiagramModel(result, options, evidence).findings;
};

test("cycle: units importing each other", () => {
  const findings = buildDiagramModel(loop(), overview).findings;
  const cycle = findings.find((finding) => finding.kind === "cycle");
  assert.equal(cycle?.text, "a and b import each other.");
  assert.deepEqual(cycle?.subjects, ["u:a", "u:b"]);
  assert.equal(cycle?.confidence, "derived");
});

test("test-leak: production code importing test code, even with tests hidden", () => {
  const findings = kinds({ ...many("src/app", 3, ["tests/helper.ts"]), "tests/helper.ts": [], "tests/a.test.ts": [], "tests/b.test.ts": [] });
  const leak = findings.find((finding) => finding.kind === "test-leak");
  assert.equal(leak?.figures.imports, 3);
  assert.match(leak?.text ?? "", /^3 imports go from production code into test code/);
});

test("hub: imported by at least 60% of the other units and at least 3", () => {
  const findings = kinds({
    ...many("core", 3), ...many("a", 3, ["core/f00.ts"]), ...many("b", 3, ["core/f00.ts"]),
    ...many("c", 3, ["core/f00.ts"]), ...many("d", 3),
  });
  const hub = findings.find((finding) => finding.kind === "hub");
  assert.equal(hub?.text, "core is imported by 3 of the 4 other parts.");
});

test("isolated: a part with no arrows in or out", () => {
  const findings = kinds({ ...many("a", 3, ["b/f00.ts"]), ...many("b", 3), ...many("lonely", 3) });
  assert.equal(findings.find((finding) => finding.kind === "isolated")?.text, "lonely neither imports nor is imported by any other part shown.");
});

test("misplaced: a file whose every connection is with one other unit (heuristic)", () => {
  const findings = kinds({
    "a/x.ts": ["b/f00.ts", "b/f01.ts", "b/f02.ts"], "a/y.ts": ["a/z.ts"], "a/z.ts": [],
    ...many("b", 3),
  });
  const misplaced = findings.find((finding) => finding.kind === "misplaced");
  assert.equal(misplaced?.confidence, "heuristic");
  assert.equal(misplaced?.text, "a/x.ts connects only outside a: all 3 of its connections involve b.");
});

test("unresolved-heavy: more than 10% of a unit's imports do not resolve", () => {
  const findings = kinds(
    { ...many("a", 3, ["b/f00.ts"]), ...many("b", 3) },
    overview,
    new Map([["a/f00.ts", 3]]),
  );
  assert.match(findings.find((finding) => finding.kind === "unresolved-heavy")?.text ?? "", /^3 of 6 imports in a do not resolve/);
});

test("findings are ordered by kind and are deterministic", () => {
  const spec = {
    "a/x.ts": ["b/x.ts", "a/y.ts"], "a/y.ts": [], "a/z.ts": [],
    "b/x.ts": ["a/x.ts", "b/y.ts"], "b/y.ts": [], "b/z.ts": [],
    ...many("lonely", 3),
  };
  const first = kinds(spec);
  assert.deepEqual(first.map((finding) => finding.kind), ["cycle", "isolated"]);
  assert.deepEqual(first, kinds(spec));
});

test("a clean repository has no findings", () => {
  // b/f00 also imports inside b, so it is not "misplaced" despite three importers from a.
  assert.deepEqual(kinds({ ...many("a", 3, ["b/f00.ts"]), "b/f00.ts": ["b/f01.ts"], "b/f01.ts": [], "b/f02.ts": [] }), []);
});

test("test-leak in a region counts only leaks from files drawn in the region", () => {
  const region = (id: string) => ({ ...defaultDiagramOptions("document"), scope: { kind: "region" as const, id } });
  const result = makeResult({ ...many("a", 5), ...many("b", 5, ["b/f00.ts"]), "a/x.ts": ["tests/helper.ts"], "tests/helper.ts": [] });
  const outside = buildDiagramModel(result, region("b")).findings.filter((finding) => finding.kind === "test-leak");
  assert.deepEqual(outside, []);
  const inside = buildDiagramModel(result, region("a")).findings.find((finding) => finding.kind === "test-leak");
  assert.ok(inside && inside.subjects.length > 0);
  assert.match(inside.text, /a\/x\.ts imports tests\/helper\.ts/);
});
