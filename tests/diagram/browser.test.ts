import assert from "node:assert/strict";
import test from "node:test";
import { svgSize } from "@/lib/diagram/browser";

test("svgSize reads the viewBox", () => {
  assert.deepEqual(svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 912.5">'), { width: 1600, height: 912.5 });
  assert.equal(svgSize("<svg>"), null);
});
