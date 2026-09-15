import test from "node:test";
import assert from "node:assert/strict";
import { createAiQueryContext, validateGrounding, assertGrounded } from "../../lib/ai";
import { getNode, findCycles, computeImpact } from "../../lib/ai/tools";
import type { AnalysisResult } from "../../types/graph";

const result = { graph: { nodes: [{ id: "a", path: "a.ts", folder: "", lineCount: 1, imports: ["b"], externalImports: [] }, { id: "b", path: "b.ts", folder: "", lineCount: 1, imports: [], externalImports: [] }], edges: [{ id: "e1", from: "a", to: "b" }] }, analysisViews: [{ analyzerId: "analyzer", tier: 1, status: "complete", missingCapabilities: [], provenance: { origin: "derived" } }] } as unknown as AnalysisResult;

test("AI tools are read-only and cite queryable nodes", () => {
  const context = createAiQueryContext(result);
  const found = getNode(context, "a");
  assert.equal(found.claims[0]?.citations[0]?.id, "a");
  assert.deepEqual(validateGrounding({ answer: "ok", claims: found.claims }, context.evidence), []);
  assert.equal(getNode(context, "missing").uncertain, true);
});

test("adversarial and empty responses fail grounding", () => {
  const context = createAiQueryContext(result);
  assert.ok(validateGrounding({ answer: "hallucination", claims: [{ text: "bad", citations: [{ kind: "node", id: "forged" }] }] }, context.evidence).length);
  assert.ok(findCycles(context).uncertain);
  assert.ok(computeImpact(context, "b").value.length === 1);
  assert.deepEqual(validateGrounding({ answer: "facts", claims: [{ text: "edge", citations: [{ kind: "edge", id: "e1" }] }, { text: "analysis", citations: [{ kind: "analyzer-result", id: "analyzer" }] }] }, context.evidence), []);
  assert.throws(() => assertGrounded({ answer: "forged", claims: [{ text: "bad", citations: [{ kind: "edge", id: "forged" }] }] }, context.evidence));
});
