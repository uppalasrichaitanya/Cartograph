import type { AiResponse, CitationKind } from "./types";

export type AiProviderName = "gemini" | "groq" | "openrouter";

export type AiProviderResult = Readonly<{
  response: AiResponse;
  provider: AiProviderName;
  model: string;
}>;

type ProviderConfig = Readonly<{
  name: AiProviderName;
  key: string;
  model: string;
}>;

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  gemini: "gemini-2.5-flash",
  groq: "openai/gpt-oss-120b",
  openrouter: "openrouter/free",
};

function configuredProviders(): ProviderConfig[] {
  const entries: Array<[AiProviderName, string | undefined, string | undefined]> = [
    ["gemini", process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL],
    ["groq", process.env.GROQ_API_KEY, process.env.GROQ_MODEL],
    ["openrouter", process.env.OPEN_ROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY, process.env.OPEN_ROUTER_MODEL ?? process.env.OPENROUTER_MODEL],
  ];
  return entries
    .filter((entry): entry is [AiProviderName, string, string | undefined] => Boolean(entry[1]?.trim()))
    .map(([name, key, model]) => ({ name, key, model: model?.trim() || DEFAULT_MODELS[name] }));
}

function requestBody(prompt: string, model: string, jsonMode: boolean): Record<string, unknown> {
  return {
    model,
    messages: [
      {
        role: "system",
        content: "You are Cartograph's evidence-bound architecture assistant. Return only valid JSON matching the requested shape. Never invent file IDs or citations.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  const payload = JSON.parse(text) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const openAiText = (choices[0] as Record<string, unknown> | undefined)?.message;
  if (openAiText && typeof openAiText === "object") {
    const content = (openAiText as Record<string, unknown>).content;
    const textContent = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part as Record<string, unknown>).text).filter((part): part is string => typeof part === "string").join("")
        : "";
    if (textContent) return parseJsonText(textContent);
  }
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const parts = ((candidates[0] as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined)?.parts;
  const geminiText = Array.isArray(parts)
    ? parts.map((part) => (part as Record<string, unknown>).text).filter((part): part is string => typeof part === "string").join("")
    : "";
  if (geminiText) return parseJsonText(geminiText);
  throw new Error("Provider returned no JSON content.");
}

function parseJsonText(text: string): unknown {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Provider returned malformed JSON.");
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function parseResponse(value: unknown): AiResponse {
  if (!value || typeof value !== "object") throw new Error("Provider returned an invalid response.");
  const body = value as Record<string, unknown>;
  const claims = Array.isArray(body.claims) ? body.claims : [];
  const normalizedClaims = claims.map((claim) => {
    if (!claim || typeof claim !== "object") throw new Error("Provider returned an invalid claim.");
    const item = claim as Record<string, unknown>;
    const citations = Array.isArray(item.citations) ? item.citations : [];
    return {
      text: typeof item.text === "string" ? item.text.trim() : "",
      citations: citations.map((citation) => {
        if (!citation || typeof citation !== "object") throw new Error("Provider returned an invalid citation.");
        const item = citation as Record<string, unknown>;
        const kind = item.kind;
        if (kind !== "node" && kind !== "edge" && kind !== "analyzer-result") throw new Error("Provider returned an invalid citation kind.");
        return { kind: kind as CitationKind, id: typeof item.id === "string" ? item.id : "" };
      }),
    };
  });
  return {
    answer: typeof body.answer === "string" ? body.answer.trim() : "",
    claims: normalizedClaims,
    ...(typeof body.uncertainty === "string" && body.uncertainty.trim() ? { uncertainty: body.uncertainty.trim() } : {}),
  };
}

async function callProvider(config: ProviderConfig, prompt: string): Promise<AiResponse> {
  const signal = AbortSignal.timeout(30_000);
  if (config.name === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.key)}`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: "You are Cartograph's evidence-bound architecture assistant. Return only valid JSON and never invent citations." }] },
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    return parseResponse(await readJsonResponse(response));
  }

  const response = await fetch(
    config.name === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
        ...(config.name === "openrouter" ? { "HTTP-Referer": "https://cartograph.dev", "X-Title": "Cartograph" } : {}),
      },
      body: JSON.stringify(requestBody(prompt, config.model, config.name === "groq")),
    },
  );
  return parseResponse(await readJsonResponse(response));
}

export async function generateAiResponse(prompt: string): Promise<AiProviderResult> {
  const providers = configuredProviders();
  if (providers.length === 0) throw new Error("No AI provider is configured. Add a server-side provider key first.");
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      return { response: await callProvider(provider, prompt), provider: provider.name, model: provider.model };
    } catch (error) {
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  throw new Error(`All configured AI providers failed. ${failures.join(" ")}`);
}
