import { DiagramOptionsError, DiagramScopeError, parseDiagramOptions, renderDiagram } from "@/lib/diagram";
import { isStoredReview, reviewAnnotations, reviewCacheKey } from "@/lib/diagram/review";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";
import { getStorage } from "@/lib/storage";
import { loadLiveAnalysis } from "@/lib/storage/live";

export const runtime = "nodejs";
export const maxDuration = 30;

const ANALYSIS_ID = /^[a-f0-9-]{36}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ANALYSIS_ID.test(id)) return Response.json({ error: "Analysis not found." }, { status: 404 });

  const url = new URL(request.url);
  let parsed;
  try {
    parsed = parseDiagramOptions(url.searchParams);
  } catch (error) {
    if (error instanceof DiagramOptionsError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const limited = enforceRateLimit(request, RATE_LIMITS.diagram);
  if (limited) return limited;

  const result = await loadLiveAnalysis(getStorage(), id);
  if (!result) return Response.json({ error: "This analysis no longer exists." }, { status: 404 });

  let rendered;
  try {
    const storage = getStorage();
    rendered = await renderDiagram(result, parsed.options, parsed.format, {
      origin: url.origin,
      loadReview: async (model) => {
        const cached = await storage.loadExplanation(id, reviewCacheKey(model));
        return isStoredReview(cached) ? reviewAnnotations(cached, model) : null;
      },
    });
  } catch (error) {
    if (error instanceof DiagramScopeError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }

  const headers = new Headers({
    "Content-Type": rendered.contentType,
    // Deterministic output, but deletion must take effect within the hour.
    "Cache-Control": "public, max-age=300, s-maxage=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${parsed.download ? "attachment" : "inline"}; filename="${rendered.filename}"`,
  });
  if (parsed.format === "svg") {
    headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; font-src data:");
  }
  if (rendered.scale !== null) headers.set("X-Cartograph-Scale", String(Math.round(rendered.scale * 100) / 100));
  if (rendered.reviewMissing) headers.set("X-Cartograph-Review", "missing");
  // A figure that asked for AI notes but has none yet must not sit in the CDN
  // for an hour; the review may finish a minute from now.
  if (rendered.reviewMissing) headers.set("Cache-Control", "no-store");
  return new Response(rendered.body, { headers });
}
