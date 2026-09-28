import test from "node:test";
import assert from "node:assert/strict";
import { buildExplainPrompt } from "../../lib/ai/explain";
import { generateAiResponse } from "../../lib/ai/provider";
import { assertGrounded } from "../../lib/ai";
import type { AnalysisResult } from "../../types/graph";

function node(id: string, imports: string[] = []) {
  return { id, path: id, folder: "", lineCount: 1, imports, externalImports: [] };
}

function edge(from: string, to: string) {
  return { id: `${from}->${to}`, from, to };
}

// A hub imported by 200 files, plus a three-file cycle that passes through it.
function hubResult(): AnalysisResult {
  const importers = Array.from({ length: 200 }, (_, index) => `src/f${String(index).padStart(3, "0")}.ts`);
  const nodes = [node("hub.ts", ["c1.ts"]), node("c1.ts", ["c2.ts"]), node("c2.ts", ["hub.ts"]), ...importers.map((id) => node(id, ["hub.ts"]))];
  const edges = [edge("hub.ts", "c1.ts"), edge("c1.ts", "c2.ts"), edge("c2.ts", "hub.ts"), ...importers.map((id) => edge(id, "hub.ts"))];
  return {
    graph: { nodes, edges },
    repoMeta: { repoName: "hub", language: "TypeScript", framework: null, fileCount: nodes.length, dependencyCount: edges.length },
    anomalies: { cycles: [["hub.ts", "c1.ts", "c2.ts", "hub.ts"]] },
    analysisViews: [],
  } as unknown as AnalysisResult;
}

test("explain prompt stays bounded for hub files", () => {
  const { prompt, allowed } = buildExplainPrompt(hubResult(), "hub.ts");
  assert.ok(allowed.nodeIds.size <= 1 + 24 * 3 + 3, `node catalog too large: ${allowed.nodeIds.size}`);
  assert.ok(allowed.edgeIds.size <= 64);
  assert.ok(prompt.length < 12_000, `prompt too large: ${prompt.length}`);
  assert.match(prompt, /"total":201/);
});

test("explain prompt allows citing every cycle member and cycle edge", () => {
  for (const subject of ["hub.ts", undefined]) {
    const { allowed } = buildExplainPrompt(hubResult(), subject);
    for (const id of ["hub.ts", "c1.ts", "c2.ts"]) assert.ok(allowed.nodeIds.has(id), `${subject}: missing node ${id}`);
    for (const id of ["hub.ts->c1.ts", "c1.ts->c2.ts", "c2.ts->hub.ts"]) assert.ok(allowed.edgeIds.has(id), `${subject}: missing edge ${id}`);
  }
});

test("explain prompt rejects unknown subjects", () => {
  assert.throws(() => buildExplainPrompt(hubResult(), "missing.ts"), /not part of this analysis/);
});

test("an ungrounded provider answer falls through to the next provider", async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  process.env.GEMINI_API_KEY = "";
  process.env.GROQ_API_KEY = "groq-test";
  process.env.OPEN_ROUTER_API_KEY = "or-test";
  const answer = (id: string) => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ answer: "a", claims: [{ text: "t", citations: [{ kind: "node", id }] }] }) } }],
  }));
  globalThis.fetch = (async (url: string | URL) => answer(String(url).includes("groq") ? "forged.ts" : "hub.ts")) as typeof fetch;
  try {
    const { allowed } = buildExplainPrompt(hubResult(), "hub.ts");
    const generated = await generateAiResponse("p", { validate: (response) => assertGrounded(response, allowed) });
    assert.equal(generated.provider, "openrouter");
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
  }
});
