import test from "node:test";
import assert from "node:assert/strict";
import { buildExplainPrompt, explanationCacheKey, finalizeExplanation, ExplainSubjectError } from "../../lib/ai/explain";
import { generateAiResponse, parseResponse, resetProviderCooldowns } from "../../lib/ai/provider";
import { dropUnsupportedFigures, evidenceNumbers } from "../../lib/ai";
import type { AnalysisResult } from "../../types/graph";

function node(id: string, imports: string[] = [], folder = "src") {
  return { id, path: id, folder, lineCount: 10, imports, externalImports: ["react"] };
}

function edge(from: string, to: string) {
  return { id: `${from}->${to}`, from, to };
}

// A hub imported by 200 files, plus a three-file cycle that passes through it.
function hubResult(): AnalysisResult {
  const importers = Array.from({ length: 200 }, (_, index) => `src/f${String(index).padStart(3, "0")}.ts`);
  const nodes = [
    node("hub.ts", ["c1.ts"], "other"), node("c1.ts", ["c2.ts"], "other"), node("c2.ts", ["hub.ts"], "other"),
    ...importers.map((id) => node(id, ["hub.ts"])),
  ];
  const edges = [edge("hub.ts", "c1.ts"), edge("c1.ts", "c2.ts"), edge("c2.ts", "hub.ts"), ...importers.map((id) => edge(id, "hub.ts"))];
  return {
    graph: { nodes, edges },
    clusters: [{ name: "other", fileIds: ["c1.ts", "c2.ts", "hub.ts"] }, { name: "src", fileIds: importers }],
    repoMeta: { repoName: "hub", language: "TypeScript", framework: null, fileCount: nodes.length, dependencyCount: edges.length },
    anomalies: { cycles: [["hub.ts", "c1.ts", "c2.ts", "hub.ts"]], godModules: [], orphans: [] },
    parseErrors: [],
    analysisViews: [],
  } as unknown as AnalysisResult;
}

test("explain prompts stay bounded for hub files, regions, and the overview", () => {
  for (const subject of [{ kind: "file", id: "hub.ts" }, { kind: "region", id: "src" }, { kind: "overview" }] as const) {
    const { prompt, allowed } = buildExplainPrompt(hubResult(), subject);
    assert.ok(allowed.nodeIds.size <= 80, `${subject.kind}: node catalog too large: ${allowed.nodeIds.size}`);
    assert.ok(allowed.edgeIds.size <= 64, `${subject.kind}: edge catalog too large`);
    assert.ok(prompt.length < 16_000, `${subject.kind}: prompt too large: ${prompt.length}`);
  }
  assert.match(buildExplainPrompt(hubResult(), { kind: "file", id: "hub.ts" }).prompt, /"total":201/);
});

test("explain prompts allow citing every cycle member and cycle edge", () => {
  for (const subject of [{ kind: "file", id: "hub.ts" }, { kind: "overview" }] as const) {
    const { allowed } = buildExplainPrompt(hubResult(), subject);
    for (const id of ["hub.ts", "c1.ts", "c2.ts"]) assert.ok(allowed.nodeIds.has(id), `${subject.kind}: missing node ${id}`);
    for (const id of ["hub.ts->c1.ts", "c1.ts->c2.ts", "c2.ts->hub.ts"]) assert.ok(allowed.edgeIds.has(id), `${subject.kind}: missing edge ${id}`);
  }
});

test("explain prompts reject unknown subjects", () => {
  assert.throws(() => buildExplainPrompt(hubResult(), { kind: "file", id: "missing.ts" }), ExplainSubjectError);
  assert.throws(() => buildExplainPrompt(hubResult(), { kind: "region", id: "missing" }), ExplainSubjectError);
});

test("cache keys differ by subject and are storage-safe", () => {
  const keys = [
    explanationCacheKey({ kind: "overview" }),
    explanationCacheKey({ kind: "file", id: "src" }),
    explanationCacheKey({ kind: "region", id: "src" }),
  ];
  assert.equal(new Set(keys).size, 3);
  for (const key of keys) assert.match(key, /^[a-f0-9]{64}$/);
});

test("finalizing keeps cited claims and drops forged citations, invented figures, and unknown reading steps", () => {
  const prompt = buildExplainPrompt(hubResult(), { kind: "file", id: "hub.ts" });
  const { response, dropped } = finalizeExplanation({
    answer: "hub.ts is imported by 201 files.",
    claims: [
      { section: "Role", text: "It is the shared hub.", citations: [{ kind: "node", id: "hub.ts" }] },
      { section: "Role", text: "It is forged.", citations: [{ kind: "node", id: "forged.ts" }] },
      { section: "Change impact", text: "Changing it affects 9999 files.", citations: [{ kind: "node", id: "hub.ts" }] },
      { section: "Made up", text: "It sits in a cycle.", citations: [{ kind: "edge", id: "c1.ts->c2.ts" }] },
    ],
    readingOrder: [{ id: "c1.ts", reason: "cycle" }, { id: "forged.ts", reason: "nope" }, { id: "c1.ts", reason: "dup" }],
  }, prompt);
  assert.deepEqual(response.claims.map((claim) => claim.text), ["It is the shared hub.", "It sits in a cycle."]);
  assert.equal(response.claims[1]?.section, "Other observations");
  assert.deepEqual(response.readingOrder?.map((step) => step.id), ["c1.ts"]);
  assert.equal(dropped, 2);
});

test("finalizing rejects a response with nothing grounded left", () => {
  const prompt = buildExplainPrompt(hubResult(), { kind: "overview" });
  assert.throws(() => finalizeExplanation({ answer: "ok", claims: [{ text: "x", citations: [{ kind: "node", id: "forged" }] }] }, prompt));
  assert.throws(() => finalizeExplanation({ answer: "It has 12345 files.", claims: [{ text: "x", citations: [{ kind: "region", id: "src" }] }] }, prompt));
});

test("figure checks ignore numbers inside identifiers and paths", () => {
  const supported = evidenceNumbers({ files: 38, list: ["a", "b"], note: "uses 7 workers" });
  const { response, dropped } = dropUnsupportedFigures({
    answer: "Built on gpt-4o and lib/v2/x.ts.",
    claims: [
      { text: "38 files and 2 lists and 7 workers.", citations: [] },
      { text: "1,234 lines.", citations: [] },
    ],
  }, supported);
  assert.equal(response.answer, "Built on gpt-4o and lib/v2/x.ts.");
  assert.equal(response.claims.length, 1);
  assert.equal(dropped, 1);
});

test("provider parsing tolerates malformed parts instead of trusting them", () => {
  const parsed = parseResponse({
    summary: " Overview ",
    claims: [{ section: "Role", text: "t", citations: [{ kind: "bogus", id: "x" }, { kind: "region", id: "src" }, null] }, "junk"],
    readingOrder: [{ id: "a.ts", reason: "start" }, { id: "", reason: "empty" }],
  });
  assert.equal(parsed.answer, "Overview");
  assert.deepEqual(parsed.claims[0]?.citations, [{ kind: "region", id: "src" }]);
  assert.equal(parsed.readingOrder?.length, 1);
});

test("an ungrounded provider answer falls through to the next provider", async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  process.env.GEMINI_API_KEY = "";
  process.env.GROQ_API_KEY = "groq-test";
  process.env.OPEN_ROUTER_API_KEY = "or-test";
  const answer = (id: string) => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ summary: "a", claims: [{ section: "Role", text: "t", citations: [{ kind: "node", id }] }] }) } }],
  }));
  globalThis.fetch = (async (url: string | URL) => answer(String(url).includes("groq") ? "forged.ts" : "hub.ts")) as typeof fetch;
  try {
    const prompt = buildExplainPrompt(hubResult(), { kind: "file", id: "hub.ts" });
    const generated = await generateAiResponse("p", { finalize: (response) => finalizeExplanation(response, prompt).response });
    assert.equal(generated.provider, "openrouter");
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
  }
});

test("rate limits and overload across all providers are reported as busy", async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";
  process.env.OPEN_ROUTER_API_KEY = "";
  process.env.OPENROUTER_API_KEY = "";
  globalThis.fetch = (async (url: string | URL) => new Response("{}", { status: String(url).includes("groq") ? 429 : 503 })) as typeof fetch;
  try {
    await assert.rejects(generateAiResponse("p"), (error: Error & { busy?: boolean }) => error.busy === true);
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
  }
});

test("a rate-limited provider is tried last until its cooldown passes", async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  resetProviderCooldowns();
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";
  process.env.OPEN_ROUTER_API_KEY = "";
  process.env.OPENROUTER_API_KEY = "";
  const calls: string[] = [];
  const ok = new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "s", claims: [] }) } }] }));
  globalThis.fetch = (async (url: string | URL) => {
    const name = String(url).includes("groq") ? "groq" : "gemini";
    calls.push(name);
    return name === "gemini" ? new Response("{}", { status: 429, headers: { "retry-after": "60" } }) : ok.clone();
  }) as typeof fetch;
  try {
    assert.equal((await generateAiResponse("p")).provider, "groq");
    assert.equal((await generateAiResponse("p")).provider, "groq");
    assert.deepEqual(calls, ["gemini", "groq", "groq"]);
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
    resetProviderCooldowns();
  }
});
