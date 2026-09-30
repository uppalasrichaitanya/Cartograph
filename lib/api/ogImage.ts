/**
 * Link-preview image for an analysis. Lives outside the route file because
 * Next.js route modules may only export HTTP handlers and config.
 *
 * @module lib/api/ogImage
 */
import { DiagramScopeError } from "@/lib/diagram";
import { renderOgPng } from "@/lib/og/render";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";
import type { StorageBackend } from "@/lib/storage";
import { isValidAnalysisId } from "@/lib/storage/interface";
import { loadLiveAnalysis } from "@/lib/storage/live";
import type { AnalysisResult } from "@/types/graph";

export type OgImageDeps = Readonly<{
  storage: StorageBackend;
  load?: (storage: StorageBackend, id: string) => Promise<AnalysisResult | null>;
  render?: (result: AnalysisResult, origin: string) => Promise<Uint8Array>;
}>;

export async function handleOgImage(request: Request, id: string, deps: OgImageDeps): Promise<Response> {
  if (!isValidAnalysisId(id)) return Response.json({ error: "Analysis not found." }, { status: 404 });
  const limited = enforceRateLimit(request, RATE_LIMITS.og);
  if (limited) return limited;

  const result = await (deps.load ?? loadLiveAnalysis)(deps.storage, id);
  if (!result) return Response.json({ error: "This analysis no longer exists." }, { status: 404 });

  const origin = new URL(request.url).origin;
  let png: Uint8Array;
  try {
    png = await (deps.render ?? renderOgPng)(result, origin);
  } catch (error) {
    // An empty model or unrenderable figure still deserves a preview.
    if (!(error instanceof DiagramScopeError)) console.error("og render failed", error);
    return Response.redirect(new URL("/og-default.png", origin), 307);
  }
  return new Response(Buffer.from(png), {
    headers: {
      "Content-Type": "image/png",
      // Deterministic output, but deletion must take effect within the hour.
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
