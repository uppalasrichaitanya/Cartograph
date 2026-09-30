import assert from "node:assert/strict";
import test from "node:test";
import { renderOgPng } from "@/lib/og/render";
import { webApp } from "../diagram/fixtures";

test("the card rasterizes to a 1200 by 630 PNG, identically on every run", async () => {
  const first = await renderOgPng(webApp(), "https://cartograph.test");
  const second = await renderOgPng(webApp(), "https://cartograph.test");
  const buffer = Buffer.from(first);
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buffer.readUInt32BE(16), 1200);
  assert.equal(buffer.readUInt32BE(20), 630);
  assert.ok(buffer.length > 20_000, "text and boxes were drawn");
  assert.equal(Buffer.compare(buffer, Buffer.from(second)), 0);
});
