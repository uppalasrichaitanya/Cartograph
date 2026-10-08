import { analyzeRepository, type AnalysisOptions, type ProgressPhase } from "@/lib/analysis/analyzeRepository";
import { AnalyzeRequestError, parseAnalyzeRequest } from "@/lib/api/analyzeRequest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * SSE comment line sent on a timer while a phase runs silently. It keeps
 * proxies from idling the connection out and lets the client detect a dead
 * connection or function (it hears nothing). It is not a progress signal: it
 * keeps flowing while an await is stuck, which the analysis time budget ends.
 */
const HEARTBEAT_MS = 10_000;
const HEARTBEAT = new TextEncoder().encode(": keep-alive\n\n");

type StreamEvent =
  | { type: "progress"; phase: ProgressPhase; detail: string }
  | { type: "result"; shareUrl: string; ownerToken: string; expiresAt: string | null }
  | { type: "error"; error: string };

function encodeEvent(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  let options: AnalysisOptions;
  try {
    options = parseAnalyzeRequest(await request.json());
  } catch (error) {
    // Only our own validation messages are person-readable; a JSON parse
    // failure gets the generic text.
    const message = error instanceof AnalyzeRequestError ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }

  const limited = await enforceRateLimit(request, RATE_LIMITS.analyze);
  if (limited) return limited;

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const heartbeat = setInterval(() => {
    writer.write(HEARTBEAT).catch(() => {});
  }, HEARTBEAT_MS);
  void (async () => {
    try {
      const result = await analyzeRepository(
        options,
        async (phase, detail) => {
          await writer.write(encodeEvent({ type: "progress", phase, detail }));
        },
        { signal: request.signal },
      );
      await writer.write(encodeEvent({
        type: "result",
        shareUrl: result.shareUrl,
        ownerToken: result.ownerToken,
        expiresAt: result.retention?.expiresAt ?? null,
      }));
    } catch (error) {
      await writer.write(
        encodeEvent({ type: "error", error: error instanceof Error ? error.message : "Analysis failed." }),
      );
    } finally {
      clearInterval(heartbeat);
      await writer.close().catch(() => {});
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
