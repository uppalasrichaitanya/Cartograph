import { analyzeRepository, type ProgressPhase } from "@/lib/analysis/analyzeRepository";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 300;

type StreamEvent =
  | { type: "progress"; phase: ProgressPhase; detail: string }
  | { type: "result"; shareUrl: string }
  | { type: "error"; error: string };

function encodeEvent(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  let zipPath: string;
  let repoName: string | undefined;
  let repoSizeBytes: number | undefined;
  try {
    const body = (await request.json()) as { zipPath?: unknown; repoName?: unknown; repoSizeBytes?: unknown };
    if (typeof body.zipPath !== "string") throw new Error("zipPath is required.");
    zipPath = body.zipPath;
    // Both are client-supplied display metadata: bound them before they are persisted.
    if (typeof body.repoName === "string" && body.repoName.trim()) repoName = body.repoName.trim().slice(0, 120);
    if (typeof body.repoSizeBytes === "number" && Number.isFinite(body.repoSizeBytes) && body.repoSizeBytes >= 0) {
      repoSizeBytes = body.repoSizeBytes;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  const limited = enforceRateLimit(request, RATE_LIMITS.analyze);
  if (limited) return limited;

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  void (async () => {
    try {
      const result = await analyzeRepository(
        { zipPath, repoName, repoSizeBytes },
        async (phase, detail) => {
          await writer.write(encodeEvent({ type: "progress", phase, detail }));
        },
      );
      await writer.write(encodeEvent({ type: "result", shareUrl: result.shareUrl }));
    } catch (error) {
      await writer.write(
        encodeEvent({ type: "error", error: error instanceof Error ? error.message : "Analysis failed." }),
      );
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
