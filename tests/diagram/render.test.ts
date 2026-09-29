import assert from "node:assert/strict";
import test from "node:test";
import { measuredNotes, renderDiagram } from "@/lib/diagram";
import { buildDiagramModel } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import { loop, webApp } from "./fixtures";

const context = { origin: "https://cartograph.test", embedFonts: false };

test("svg output carries its content type, filename, and slide scale", async () => {
  const rendered = await renderDiagram(webApp(), defaultDiagramOptions("slide"), "svg", context);
  assert.equal(rendered.contentType, "image/svg+xml; charset=utf-8");
  assert.equal(rendered.filename, "fixture-architecture.svg");
  assert.ok(rendered.scale !== null && rendered.scale > 0);
});

test("mermaid output is plain text", async () => {
  const rendered = await renderDiagram(webApp(), defaultDiagramOptions(), "mermaid", context);
  assert.equal(rendered.contentType, "text/plain; charset=utf-8");
  assert.equal(rendered.filename, "fixture-architecture.mmd");
  assert.match(rendered.body, /flowchart LR/);
});

test("measured notes come from findings, in order", () => {
  const model = buildDiagramModel(loop(), defaultDiagramOptions());
  assert.deepEqual(measuredNotes(model).map((note) => [note.source, note.text]), [["measured", "a and b import each other."]]);
});

test("asking for AI notes without a cached review is reported, not fatal", async () => {
  const rendered = await renderDiagram(webApp(), { ...defaultDiagramOptions(), annotations: "measured+ai" }, "svg", context);
  assert.equal(rendered.reviewMissing, true);
});

test("AI annotations are loaded only when asked for, and drawn when present", async () => {
  let calls = 0;
  const loadReview = async () => {
    calls += 1;
    return { captions: new Map([["u:app", "Web entry points"]]), notes: [] };
  };
  await renderDiagram(webApp(), defaultDiagramOptions(), "svg", { ...context, loadReview });
  assert.equal(calls, 0);
  const rendered = await renderDiagram(webApp(), { ...defaultDiagramOptions(), annotations: "measured+ai" }, "svg", { ...context, loadReview });
  assert.equal(calls, 1);
  assert.equal(rendered.reviewMissing, false);
  assert.match(rendered.body, /Web entry points/);
});

test("mermaid never asks for AI annotations", async () => {
  let calls = 0;
  await renderDiagram(webApp(), { ...defaultDiagramOptions(), annotations: "measured+ai" }, "mermaid", {
    ...context,
    loadReview: async () => { calls += 1; return null; },
  });
  assert.equal(calls, 0);
});
