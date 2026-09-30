import assert from "node:assert/strict";
import test from "node:test";
import { renderDiagram } from "@/lib/diagram";
import { buildDiagramModel } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import { composeOgCard } from "@/lib/og/card";
import { rasterizeCard, renderOgPng } from "@/lib/og/render";
import { makeResult, webApp } from "../diagram/fixtures";

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

test("a one-part repository gets the summary card, still a 1200 by 630 PNG", async () => {
  const tiny = makeResult({ "src/a.ts": ["src/b.ts"], "src/b.ts": [] });
  const buffer = Buffer.from(await renderOgPng({ ...tiny, repoMeta: { ...tiny.repoMeta, repoName: "a<&\">b" } }, "https://cartograph.test"));
  assert.equal(buffer.readUInt32BE(16), 1200);
  assert.equal(buffer.readUInt32BE(20), 630);
  assert.ok(buffer.length > 10_000);
});

test("a three-unit repository takes the figure path, not the summary card", async () => {
  const three = makeResult({ "a/x.ts": ["b/x.ts"], "b/x.ts": ["c/x.ts"], "c/x.ts": [] });
  const model = buildDiagramModel(three, defaultDiagramOptions("slide"));
  assert.ok(model.units.length >= 3, "fixture has three units");
  const buffer = Buffer.from(await renderOgPng(three, "https://cartograph.test"));
  const figure = composeOgCard((await renderDiagram(three, { ...defaultDiagramOptions("slide"), annotations: "measured" }, "svg", { origin: "https://cartograph.test", embedFonts: false })).body);
  assert.equal(Buffer.compare(buffer, Buffer.from(rasterizeCard(figure))), 0, "identical to the figure card");
});
