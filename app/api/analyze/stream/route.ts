import { analyzeRepository, type ProgressPhase } from "@/lib/analysis/analyzeRepository";

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
  let blobUrl: string;
  try {
    const body = (await request.json()) as { blobUrl?: unknown };
    if (typeof body.blobUrl !== "string") throw new Error("blobUrl is required.");
    blobUrl = body.blobUrl;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  void (async () => {
    try {
      const result = await analyzeRepository(blobUrl, async (phase, detail) => {
        await writer.write(encodeEvent({ type: "progress", phase, detail }));
      });
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
