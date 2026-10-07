/**
 * Client side of POST /api/analyze/stream.
 *
 * Reads the server-sent events and resolves with the result. It never leaves
 * the caller waiting forever: a server `error` event, a stream that ends
 * without a result, and a stream that goes silent for `idleTimeoutMs` all
 * reject with a message that can be shown to the person.
 */

export type AnalysisProgress = { phase: string; detail: string };

export type StreamMessage =
  | { type: "progress"; phase: string; detail: string }
  | { type: "result"; shareUrl: string; ownerToken: string; expiresAt: string | null }
  | { type: "error"; error: string };

/**
 * Longest allowed gap between server events. Every analysis phase announces
 * itself and the slowest measured phase takes seconds, so a minute of silence
 * means the connection or the function is gone.
 */
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

export class StreamIdleError extends Error {
  constructor() {
    super(
      "The analysis stopped responding. It may have been too large to finish. Try again, or try a smaller repository or a subfolder zip.",
    );
    this.name = "StreamIdleError";
  }
}

export async function consumeAnalysisStream(
  requestBody: Record<string, unknown>,
  onProgress: (progress: AnalysisProgress) => void,
  {
    signal,
    fetchImpl = fetch,
    idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
  }: { signal: AbortSignal; fetchImpl?: typeof fetch; idleTimeoutMs?: number },
): Promise<Extract<StreamMessage, { type: "result" }>> {
  const response = await fetchImpl("/api/analyze/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not start analysis.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  // Each read races an idle timer that restarts on every read.
  const readWithIdleTimeout = () =>
    new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new StreamIdleError()), idleTimeoutMs);
      reader.read().then(
        (chunk) => {
          clearTimeout(timer);
          resolve(chunk);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout();
      buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = buffered.split("\n\n");
      buffered = events.pop() ?? "";
      for (const event of events) {
        const line = event.split("\n").find((part) => part.startsWith("data: "));
        if (!line) continue;
        const message = JSON.parse(line.slice(6)) as StreamMessage;
        if (message.type === "progress") onProgress({ phase: message.phase, detail: message.detail });
        if (message.type === "result") return message;
        if (message.type === "error") throw new Error(message.error);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error("The analysis stream ended before a result was returned.");
}
