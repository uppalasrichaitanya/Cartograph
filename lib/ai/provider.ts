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
    // `||`, not `??`: an empty OPEN_ROUTER_API_KEY copied from .env.example must still fall back.
    ["openrouter", process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY, process.env.OPEN_ROUTER_MODEL || process.env.OPENROUTER_MODEL],
  ];
  return entries
    .filter((entry): entry is [AiProviderName, string, string | undefined] => Boolean(entry[1]?.trim()))
    .map(([name, key, model]) => ({ name, key, model: model?.trim() || DEFAULT_MODELS[name] }));
}

/** Whether any provider key is configured on this deployment. */
export function hasAiProvider(): boolean {
  return configuredProviders().length > 0;
}

const SYSTEM_PROMPT =
  "You are Cartograph's evidence-bound architecture guide. You help developers understand an unfamiliar codebase from static-analysis evidence. Return only valid JSON matching the requested shape. Never invent file IDs, citations, or figures.";

/** Thrown when every configured provider failed; `busy` means only rate limits or overload were seen. */
export class AiUnavailableError extends Error {
  constructor(readonly failures: ReadonlyArray<string>, readonly busy: boolean) {
    super(`All configured AI providers failed. ${failures.join(" ")}`);
  }
}

class ProviderHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number | null) {
    super(`Provider returned HTTP ${status}.`);
  }
}

function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) * 1000 : null;
}

/**
 * Providers that just rate-limited or failed with overload are tried last
 * until their cooldown passes, so the next request goes straight to one that
 * is likely to answer. Per server instance, like the route rate limits.
 */
const cooldownUntil = new Map<AiProviderName, number>();
const DEFAULT_COOLDOWN_MS = { rateLimited: 30_000, overloaded: 20_000 } as const;

/** Test hook: forget every provider cooldown. */
export function resetProviderCooldowns(): void {
  cooldownUntil.clear();
}

function orderByAvailability(providers: ProviderConfig[], now: number): ProviderConfig[] {
  const ready = providers.filter((provider) => (cooldownUntil.get(provider.name) ?? 0) <= now);
  const cooling = providers.filter((provider) => (cooldownUntil.get(provider.name) ?? 0) > now);
  return [...ready, ...cooling];
}

/** Reasoning models spend output tokens thinking, and free tiers meter tokens per minute. */
function reasoningOptions(config: ProviderConfig): Record<string, unknown> {
  return config.name === "groq" && config.model.includes("gpt-oss") ? { reasoning_effort: "low" } : {};
}

function requestBody(prompt: string, config: ProviderConfig, jsonMode: boolean): Record<string, unknown> {
  return {
    model: config.model,
    ...reasoningOptions(config),
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new ProviderHttpError(response.status, retryAfterMs(response));
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

const CITATION_KINDS: ReadonlySet<string> = new Set<CitationKind>(["node", "edge", "region", "analyzer-result"]);

/**
 * Some models emit narrow no-break spaces and non-breaking hyphens, which the
 * interface font renders with no width, gluing words together.
 */
function normalizeTypography(value: string): string {
  return value.replace(/[  -   　]/g, " ").replace(/[​⁠﻿]/g, "").replace(/‑/g, "-");
}

function text(value: unknown, limit = 2_000): string {
  return typeof value === "string" ? normalizeTypography(value).trim().slice(0, limit) : "";
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/**
 * Normalizes a provider's JSON into an AiResponse. Malformed parts are
 * dropped rather than trusted: an unknown citation kind becomes no citation,
 * and grounding then decides whether the claim survives.
 */
export function parseResponse(value: unknown): AiResponse {
  if (!value || typeof value !== "object") throw new Error("Provider returned an invalid response.");
  const body = value as Record<string, unknown>;
  const claims = records(body.claims).map((item) => {
    const section = text(item.section, 60);
    return {
      text: text(item.text),
      citations: records(item.citations)
        .filter((citation) => typeof citation.kind === "string" && CITATION_KINDS.has(citation.kind))
        .map((citation) => ({ kind: citation.kind as CitationKind, id: text(citation.id, 500) })),
      ...(section ? { section } : {}),
    };
  });
  const readingOrder = records(body.readingOrder)
    .map((step) => ({ id: text(step.id, 500), reason: text(step.reason, 300) }))
    .filter((step) => step.id && step.reason);
  const uncertainty = text(body.uncertainty);
  return {
    answer: text(body.summary) || text(body.answer),
    claims,
    ...(uncertainty ? { uncertainty } : {}),
    ...(readingOrder.length ? { readingOrder } : {}),
  };
}

async function callProvider(config: ProviderConfig, prompt: string, timeoutMs: number): Promise<AiResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  if (config.name === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      signal,
      // Header rather than query string so the key never appears in request logs.
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
      body: JSON.stringify(requestBody(prompt, config, config.name === "groq")),
    },
  );
  return parseResponse(await readJsonResponse(response));
}

export type GenerateOptions = Readonly<{
  /** Total time budget across the whole provider chain. */
  budgetMs?: number;
  /** Upper bound for a single provider attempt. */
  perProviderMs?: number;
  /**
   * Checks and cleans a response. Throwing rejects it and the chain falls
   * through to the next provider.
   */
  finalize?: (response: AiResponse) => AiResponse;
}>;

const MIN_ATTEMPT_MS = 3_000;

export async function generateAiResponse(prompt: string, options: GenerateOptions = {}): Promise<AiProviderResult> {
  const { budgetMs = 40_000, perProviderMs = 20_000, finalize } = options;
  const providers = orderByAvailability(configuredProviders(), Date.now());
  if (providers.length === 0) throw new Error("No AI provider is configured. Add a server-side provider key first.");
  const deadline = Date.now() + budgetMs;
  const failures: string[] = [];
  let onlyBusy = true;
  for (const [position, provider] of providers.entries()) {
    const remaining = deadline - Date.now();
    const isLast = position === providers.length - 1;
    if (remaining < MIN_ATTEMPT_MS) {
      failures.push(`${provider.name}: skipped, time budget exhausted`);
      continue;
    }
    try {
      // The last provider may use whatever time is left; free models are often slow.
      const raw = await callProvider(provider, prompt, isLast ? remaining : Math.min(perProviderMs, remaining));
      const response = finalize ? finalize(raw) : raw;
      return { response, provider: provider.name, model: provider.model };
    } catch (error) {
      const busy = (error instanceof ProviderHttpError && (error.status === 429 || error.status >= 500))
        || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
      if (!busy) onlyBusy = false;
      if (error instanceof ProviderHttpError && (error.status === 429 || error.status >= 500)) {
        const fallback = error.status === 429 ? DEFAULT_COOLDOWN_MS.rateLimited : DEFAULT_COOLDOWN_MS.overloaded;
        cooldownUntil.set(provider.name, Date.now() + (error.retryAfterMs ?? fallback));
      }
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  throw new AiUnavailableError(failures, onlyBusy);
}
