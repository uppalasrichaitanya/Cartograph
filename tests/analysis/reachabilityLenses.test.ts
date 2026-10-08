import assert from "node:assert/strict";
import test from "node:test";
import { buildReachabilityLenses, groupEntryPoints, reachabilityLensFiles } from "@/lib/analysis/reachabilityLenses";
import type { ReachabilityResult } from "@/types/graph";

const reach: ReachabilityResult = {
  version: 1,
  entryPoints: [
    { path: "a.test.ts", reason: "test file" },
    { path: "b.test.ts", reason: "test file" },
    { path: "c.test.ts", reason: "test file" },
    { path: "index.ts", reason: 'package.json "main"' },
    { path: "app/page.tsx", reason: "Next.js route (app/page.tsx)" },
    { path: "app/b/page.tsx", reason: "Next.js route (app/b/page.tsx)" },
  ],
  unreachable: ["old.ts", "legacy/x.ts"],
  caveats: ["a quiet note"],
};

test("entry points are grouped by rule with counts, non-test rules first", () => {
  const groups = groupEntryPoints(reach.entryPoints);
  assert.deepEqual(groups.map((g) => [g.rule, g.count]), [
    ["Next.js route", 2],
    ['package.json "main"', 1],
    ["test file", 3],
  ]);
  assert.equal(groups[0].first, "app/b/page.tsx");
});

test("the lenses exist only when a search ran", () => {
  assert.deepEqual(buildReachabilityLenses(undefined), []);
  assert.deepEqual(buildReachabilityLenses({ ...reach, entryPoints: [], unreachable: [] }), []);
  assert.deepEqual(buildReachabilityLenses(reach).map((l) => l.mode), ["entries", "unreachable"]);
});

test("the entries lens lists one row per rule with its count", () => {
  const [entries] = buildReachabilityLenses(reach);
  assert.equal(entries.label, "Entry points");
  const items = entries.items();
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.label), ["Next.js route · 2", 'package.json "main" · 1', "test file · 3"]);
});

test("the unreachable lens lists the files, states its measurement, and carries the caveats", () => {
  const lens = buildReachabilityLenses(reach)[1];
  assert.equal(lens.label, "Unreachable from entry points");
  assert.equal(lens.note, "No import path from any recognised entry point.");
  assert.deepEqual(lens.items().map((i) => i.target), ["old.ts", "legacy/x.ts"]);
  assert.deepEqual(lens.caveats, ["a quiet note"]);
});

test("no lens text states a verdict", () => {
  for (const lens of buildReachabilityLenses(reach)) {
    const text = [lens.label, lens.note, lens.empty, ...lens.items().map((i) => i.label)].join(" ");
    assert.doesNotMatch(text, /\bdead\b|\bunused\b/i);
  }
});

test("the entries lens emphasises non-test entry points, so a repo of mostly tests still dims something", () => {
  assert.deepEqual([...reachabilityLensFiles(reach, "entries")!].sort(), ["app/b/page.tsx", "app/page.tsx", "index.ts"]);
  assert.deepEqual([...reachabilityLensFiles(reach, "unreachable")!].sort(), ["legacy/x.ts", "old.ts"]);
});

test("a lens with nothing to emphasise, or no search, returns null instead of dimming everything", () => {
  assert.equal(reachabilityLensFiles(undefined, "entries"), null);
  assert.equal(reachabilityLensFiles({ ...reach, entryPoints: [] }, "unreachable"), null);
  assert.equal(reachabilityLensFiles({ ...reach, entryPoints: [{ path: "a.test.ts", reason: "test file" }] }, "entries"), null);
});
