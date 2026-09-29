import { NextResponse } from "next/server";
import {
  buildExplainPrompt,
  explanationCacheKey,
  ExplainSubjectError,
  finalizeExplanation,
  type ExplainSubject,
} from "@/lib/ai/explain";
import { AiUnavailableError, generateAiResponse } from "@/lib/ai/provider";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";
import { getStorage } from "@/lib/storage";
import { loadLiveAnalysis } from "@/lib/storage/live";

export const runtime = "nodejs";
export const maxDuration = 45;

type ExplainRequest = Readonly<{
  analysisId?: unknown;
  subject?: unknown;
  /** Legacy shape: a file subject. */
  nodeId?: unknown;
  refresh?: unknown;
}>;

function parseSubject(body: ExplainRequest): ExplainSubject | null {
  if (body.subject === undefined) {
    if (body.nodeId === undefined) return { kind: "overview" };
    return typeof body.nodeId === "string" && body.nodeId ? { kind: "file", id: body.nodeId } : null;
  }
  if (!body.subject || typeof body.subject !== "object") return null;
  const { kind, id } = body.subject as Record<string, unknown>;
  if (kind === "overview") return { kind };
  if ((kind === "file" || kind === "region") && typeof id === "string" && id && id.length <= 1_000) return { kind, id };
  return null;
}

function isCachedExplanation(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.answer === "string" && Array.isArray(candidate.claims);
}

// Concurrent requests for the same explanation share one provider call.
const inFlight = new Map<string, Promise<Record<string, unknown>>>();

export async function POST(request: Request) {
  let body: ExplainRequest;
  try {
    body = (await request.json()) as ExplainRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }
  if (typeof body.analysisId !== "string" || !body.analysisId.trim()) {
    return NextResponse.json({ error: "analysisId is required." }, { status: 400 });
  }
  const subject = parseSubject(body);
  if (!subject) return NextResponse.json({ error: "subject must be an overview, file, or region." }, { status: 400 });
  const analysisId = body.analysisId;

  const storage = getStorage();
  const result = await loadLiveAnalysis(storage, analysisId);
  if (!result) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });

  let explainPrompt;
  try {
    explainPrompt = buildExplainPrompt(result, subject);
  } catch (error) {
    if (error instanceof ExplainSubjectError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }

  // Explanations depend only on the stored analysis and the subject, so a
  // cached answer is as good as a fresh one and costs no provider quota.
  const cacheKey = explanationCacheKey(subject);
  if (body.refresh !== true) {
    const cached = await storage.loadExplanation(analysisId, cacheKey);
    if (isCachedExplanation(cached)) return NextResponse.json({ ...cached, cached: true });
  }

  const flightKey = `${analysisId}:${cacheKey}`;
  const pending = inFlight.get(flightKey);
  if (pending) {
    try {
      return NextResponse.json({ ...(await pending), cached: false });
    } catch {
      return NextResponse.json({ error: "AI explanation failed. Try again." }, { status: 502 });
    }
  }

  const limited = enforceRateLimit(request, RATE_LIMITS.aiPerClient, RATE_LIMITS.aiGlobal);
  if (limited) return limited;

  const generation = (async () => {
    let dropped = 0;
    const generated = await generateAiResponse(explainPrompt.prompt, {
      budgetMs: 40_000,
      finalize: (response) => {
        const finalized = finalizeExplanation(response, explainPrompt);
        dropped = finalized.dropped;
        return finalized.response;
      },
    });
    const payload = {
      ...generated.response,
      subject,
      dropped,
      provider: generated.provider,
      model: generated.model,
      generatedAt: new Date().toISOString(),
    };
    await storage.saveExplanation(analysisId, cacheKey, payload);
    return payload;
  })();
  inFlight.set(flightKey, generation);

  try {
    return NextResponse.json({ ...(await generation), cached: false });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      console.error("[ai/explain] provider chain failed:", error.failures.join(" | "));
      return NextResponse.json(
        {
          error: error.busy
            ? "The free AI providers are busy or rate-limited right now. Try again in a minute."
            : "The AI providers could not produce a grounded explanation this time. Try again.",
        },
        { status: error.busy ? 503 : 502 },
      );
    }
    const message = error instanceof Error ? error.message : "AI explanation failed.";
    const unconfigured = message.startsWith("No AI provider is configured");
    return NextResponse.json(
      { error: unconfigured ? "AI explanations are not configured on this deployment." : message },
      { status: unconfigured ? 503 : 502 },
    );
  } finally {
    inFlight.delete(flightKey);
  }
}
