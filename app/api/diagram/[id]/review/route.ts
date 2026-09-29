import { NextResponse } from "next/server";
import { AiUnavailableError, generateAiResponse, hasAiProvider } from "@/lib/ai/provider";
import { DiagramOptionsError, DiagramScopeError, parseDiagramOptions } from "@/lib/diagram";
import { buildDiagramModel } from "@/lib/diagram/model";
import { buildReviewPrompt, finalizeReview, isStoredReview, reviewCacheKey, type StoredReview } from "@/lib/diagram/review";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 45;

const ANALYSIS_ID = /^[a-f0-9-]{36}$/i;
const inFlight = new Map<string, Promise<StoredReview>>();

function present(review: StoredReview, cached: boolean) {
  return {
    summary: review.answer,
    captions: review.claims.filter((claim) => claim.section === "caption").map((claim) => ({ unitId: claim.citations[0]?.id, text: claim.text })),
    notes: review.claims.filter((claim) => claim.section === "note").map((claim) => ({ text: claim.text, subjects: claim.citations.map((citation) => citation.id) })),
    ...(review.uncertainty ? { uncertainty: review.uncertainty } : {}),
    dropped: review.dropped,
    provider: review.provider,
    model: review.model,
    generatedAt: review.generatedAt,
    cached,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ANALYSIS_ID.test(id)) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });

  let options;
  try {
    options = parseDiagramOptions(new URL(request.url).searchParams).options;
  } catch (error) {
    if (error instanceof DiagramOptionsError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const body = (await request.json().catch(() => ({}))) as { refresh?: unknown };

  const storage = getStorage();
  const result = await storage.loadAnalysis(id);
  if (!result) return NextResponse.json({ error: "This analysis no longer exists." }, { status: 404 });

  let model;
  try {
    model = buildDiagramModel(result, options);
  } catch (error) {
    if (error instanceof DiagramScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }

  const key = reviewCacheKey(model);
  if (body.refresh !== true) {
    const cached = await storage.loadExplanation(id, key);
    if (isStoredReview(cached)) return NextResponse.json(present(cached, true));
  }

  const flightKey = `${id}:${key}`;
  const pending = inFlight.get(flightKey);
  if (pending) {
    try { return NextResponse.json(present(await pending, false)); }
    catch { return NextResponse.json({ error: "AI review failed. Try again." }, { status: 502 }); }
  }

  // Cached reviews are served above even if keys are later removed; only a new
  // generation needs a provider.
  if (!hasAiProvider()) return NextResponse.json({ error: "AI review is not configured on this deployment." }, { status: 503 });

  const limited = enforceRateLimit(request, RATE_LIMITS.aiPerClient, RATE_LIMITS.aiGlobal);
  if (limited) return limited;

  const prompt = buildReviewPrompt(model, result);
  const generation = (async (): Promise<StoredReview> => {
    let dropped = 0;
    const generated = await generateAiResponse(prompt.prompt, {
      budgetMs: 40_000,
      finalize: (response) => {
        const finalized = finalizeReview(response, prompt);
        dropped = finalized.dropped;
        return finalized.response;
      },
    });
    const review: StoredReview = {
      ...generated.response,
      dropped,
      provider: generated.provider,
      model: generated.model,
      generatedAt: new Date().toISOString(),
    };
    await storage.saveExplanation(id, key, review);
    return review;
  })();
  inFlight.set(flightKey, generation);

  try {
    return NextResponse.json(present(await generation, false));
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      console.error("[diagram/review] provider chain failed:", error.failures.join(" | "));
      return NextResponse.json(
        { error: error.busy ? "The free AI providers are busy or rate-limited right now. Try again in a minute." : "The AI providers could not produce a grounded review this time. Try again." },
        { status: error.busy ? 503 : 502 },
      );
    }
    const message = error instanceof Error ? error.message : "AI review failed.";
    const unconfigured = message.startsWith("No AI provider is configured");
    return NextResponse.json(
      { error: unconfigured ? "AI review is not configured on this deployment." : message },
      { status: unconfigured ? 503 : 502 },
    );
  } finally {
    inFlight.delete(flightKey);
  }
}
