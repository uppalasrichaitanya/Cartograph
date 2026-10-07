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
 * Longest allowed gap between bytes from the server, measured from the moment
 * the request is sent. The server sends a keep-alive every 10 s from a timer,
 * and stops the analysis itself after its 240 s budget with a readable error
 * event, so this is not a progress detector: a stuck analysis still gets
 * heartbeats until the server gives up. It only catches what the server
 * cannot report: a dead connection, a frozen or killed function, or a hang
 * before the first byte. It is set above the server budget (and below the
 * function's 300 s limit) so it can never fire before a legitimate slow
 * result or the server's own timeout message.
 */
export const STREAM_IDLE_TIMEOUT_MS = 280_000;

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
  // The request runs on a derived signal so the idle timer can cancel it too.
  const request = new AbortController();
  const forwardAbort = () => request.abort(signal.reason);
  if (signal.aborted) forwardAbort();
  else signal.addEventListener("abort", forwardAbort, { once: true });

  // One idle timer covers the wait for the response and every later read; it
  // restarts whenever bytes (events or keep-alives) arrive.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectIdle: (error: Error) => void = () => {};
  const idle = new Promise<never>((_resolve, reject) => { rejectIdle = reject; });
  idle.catch(() => {});
  const armIdleTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      rejectIdle(new StreamIdleError());
      request.abort();
    }, idleTimeoutMs);
  };
  armIdleTimer();

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([
      fetchImpl("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: request.signal,
      }),
      idle,
    ]);
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not start analysis.");
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { done, value } = await Promise.race([reader.read(), idle]);
      armIdleTimer();
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
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardAbort);
    // Fire and forget: cancelling a dead socket can stall, and must never
    // hold back the error that is about to be shown.
    void reader?.cancel().catch(() => {});
  }
  throw new Error("The analysis stream ended before a result was returned.");
}
