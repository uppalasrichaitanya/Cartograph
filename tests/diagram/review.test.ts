import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagramModel } from "@/lib/diagram/model";
import { defaultDiagramOptions } from "@/lib/diagram/options";
import { buildReviewPrompt, finalizeReview, reviewAnnotations, reviewCacheKey } from "@/lib/diagram/review";
import type { AiResponse } from "@/lib/ai/types";
import { loop, makeResult, webApp } from "./fixtures";

const options = defaultDiagramOptions("document");
const model = () => buildDiagramModel(webApp(), options);
const prompt = () => buildReviewPrompt(model(), webApp());

const claim = (section: string, text: string, citations: AiResponse["claims"][number]["citations"]) => ({ section, text, citations });

test("the prompt is bounded and lists exactly the figure's units and edges", () => {
  const built = prompt();
  const m = model();
  assert.deepEqual([...(built.allowed.regionIds ?? [])].sort(), m.units.map((unit) => unit.id).sort());
  assert.deepEqual([...built.allowed.edgeIds].sort(), m.edges.map((edge) => edge.id).sort());
  assert.ok(built.prompt.length < 20_000, `prompt is ${built.prompt.length} characters`);
  assert.match(built.prompt, /never suggest moving, merging, or renaming boxes/i);
});

test("a large repository still produces a bounded prompt", () => {
  const spec: Record<string, string[]> = {};
  for (let i = 0; i < 60; i += 1) for (let k = 0; k < 20; k += 1) spec[`p${i}/f${k}.ts`] = k ? [`p${(i + 1) % 60}/f0.ts`] : [];
  const result = makeResult(spec);
  const built = buildReviewPrompt(buildDiagramModel(result, options), result);
  assert.ok(built.prompt.length < 20_000);
});

test("captions: one per real unit, short, no digits, cite exactly that unit", () => {
  const built = prompt();
  const { response, dropped } = finalizeReview({
    answer: "A web app with an analysis core.",
    claims: [
      claim("caption", "Web entry points.", [{ kind: "region", id: "u:app" }]),
      claim("caption", "Second caption for app", [{ kind: "region", id: "u:app" }]),
      claim("caption", "Has 3 files", [{ kind: "region", id: "u:components" }]),
      claim("caption", "x".repeat(49), [{ kind: "region", id: "u:lib/ai" }]),
      claim("caption", "Ghost unit", [{ kind: "region", id: "u:ghost" }]),
      claim("caption", "Two subjects", [{ kind: "region", id: "u:app" }, { kind: "region", id: "u:components" }]),
    ],
  }, built);
  const captions = response.claims.filter((item) => item.section === "caption");
  assert.deepEqual(captions.map((item) => [item.citations[0].id, item.text]), [["u:app", "Web entry points"]]);
  assert.equal(dropped, 5);
});

test("notes: cited, bounded, and free of invented figures", () => {
  const built = prompt();
  const { response } = finalizeReview({
    answer: "Summary.",
    claims: [
      claim("note", "The analysis core is imported from the web layer directly.", [{ kind: "edge", id: built.allowed.edgeIds.values().next().value! }]),
      claim("note", "There are 999 hidden dependencies.", [{ kind: "region", id: "u:app" }]),
      claim("note", "y".repeat(241), [{ kind: "region", id: "u:app" }]),
      claim("note", "Uncited note", []),
    ],
  }, built);
  assert.deepEqual(response.claims.map((item) => item.text), ["The analysis core is imported from the web layer directly."]);
});

test("a review with only notes is accepted; one with nothing grounded is rejected", () => {
  const built = prompt();
  assert.doesNotThrow(() => finalizeReview({ answer: "S.", claims: [claim("note", "Web code depends on storage.", [{ kind: "region", id: "u:app" }])] }, built));
  assert.throws(() => finalizeReview({ answer: "S.", claims: [claim("caption", "Ghost", [{ kind: "region", id: "u:ghost" }])] }, built));
});

test("the cache key is stable, 64 hex characters, and changes with the figure", () => {
  const a = reviewCacheKey(model());
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, reviewCacheKey(model()));
  assert.notEqual(a, reviewCacheKey(buildDiagramModel(webApp(), { ...options, detail: "overview" })));
  assert.notEqual(a, reviewCacheKey(buildDiagramModel(loop(), options)));
});

test("stored reviews become annotations only for units on this figure", () => {
  const annotations = reviewAnnotations({
    answer: "S.",
    claims: [
      { section: "caption", text: "Web entry points", citations: [{ kind: "region", id: "u:app" }] },
      { section: "caption", text: "Gone", citations: [{ kind: "region", id: "u:ghost" }] },
      { section: "note", text: "A note.", citations: [{ kind: "region", id: "u:app" }] },
    ],
    dropped: 0, provider: "gemini", model: "m", generatedAt: "2026-09-29T00:00:00.000Z",
  }, model());
  assert.deepEqual([...annotations.captions], [["u:app", "Web entry points"]]);
  assert.deepEqual(annotations.notes, [{ text: "A note.", subjects: ["u:app"], source: "ai" }]);
});
