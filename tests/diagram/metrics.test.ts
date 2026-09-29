import assert from "node:assert/strict";
import test from "node:test";
import { edgeStroke, formatCount, monoWidth, truncateEnd, truncateMiddle, unitBox, unitMeta, UNIT_WIDTH } from "@/lib/diagram/metrics";
import type { DiagramUnit } from "@/lib/diagram/types";

const unit = (over: Partial<DiagramUnit> = {}): DiagramUnit => ({
  id: "u:lib", kind: "folder", label: "lib", path: "lib", groupId: null, files: 12, lines: 4120,
  testFiles: 0, reducedConfidence: 0, internalImports: 3, inCycle: false, ...over,
});

test("Plex Mono advance is exactly 0.6 em", () => {
  assert.equal(monoWidth("abcde", 10), 30);
});

test("truncation keeps both ends and counts code points", () => {
  assert.equal(truncateMiddle("lib/analysis/parsers", 11), "lib/a…rsers");
  assert.equal(truncateMiddle("short", 11), "short");
  assert.equal(truncateEnd("a long caption here", 8), "a long …");
});

test("counts are compact and locale-free", () => {
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(4120), "4.1k");
  assert.equal(formatCount(3000), "3k");
});

test("unit meta lines describe what the box holds", () => {
  assert.equal(unitMeta(unit()), "12 files · 4.1k lines");
  assert.equal(unitMeta(unit({ files: 1, reducedConfidence: 1 })), "1 file · 4.1k lines · 1 partial");
  assert.equal(unitMeta(unit({ kind: "file", files: 1, lines: 80 })), "80 lines");
  assert.equal(unitMeta(unit({ kind: "unresolved" })), "targets not found");
});

test("unit boxes clamp width, truncate labels, and reserve a caption row", () => {
  const wide = unitBox(unit({ label: "x".repeat(200) }), "document", false);
  assert.equal(wide.width, UNIT_WIDTH.document.max);
  assert.ok(wide.label.includes("…"));
  // A file unit's meta ("80 lines") is short, so the label alone decides and the minimum applies.
  const narrow = unitBox(unit({ label: "a", kind: "file", files: 1, lines: 80 }), "document", false);
  assert.equal(narrow.width, UNIT_WIDTH.document.min);
  const withCaption = unitBox(unit(), "document", true);
  assert.ok(withCaption.height > unitBox(unit(), "document", false).height);
});

test("edge stroke is logarithmic, clamped, and heavier on slides", () => {
  assert.equal(edgeStroke(1, "document"), 1.25);
  assert.equal(edgeStroke(2, "document"), 2);
  assert.equal(edgeStroke(10_000, "document"), 4.5);
  assert.equal(edgeStroke(2, "slide"), 2.5);
});
