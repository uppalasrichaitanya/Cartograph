import assert from "node:assert/strict";
import test from "node:test";
import { consumeAnalysisStream } from "@/lib/client/analysisStream";

function sse(event: object): Uint8Array {
  const e = event as { type: string };
  return new TextEncoder().encode(`event: ${e.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** A fetch whose body emits the given chunks, then either closes or stays open. */
function fakeFetch(chunks: Uint8Array[], { close }: { close: boolean }): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (close) controller.close();
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}

const options = (fetchImpl: typeof fetch, idleTimeoutMs = 80) => ({ fetchImpl, idleTimeoutMs, signal: new AbortController().signal });

test("returns the result event and reports progress", async () => {
  const seen: string[] = [];
  const result = await consumeAnalysisStream(
    {},
    (p) => seen.push(p.phase),
    { ...options(fakeFetch([sse({ type: "progress", phase: "parsing", detail: "x" }), sse({ type: "result", shareUrl: "/repo/1", ownerToken: "t", expiresAt: null })], { close: true })) },
  );
  assert.equal(result.shareUrl, "/repo/1");
  assert.deepEqual(seen, ["parsing"]);
});

test("a server error event becomes a thrown error with its message", async () => {
  await assert.rejects(
    consumeAnalysisStream({}, () => {}, options(fakeFetch([sse({ type: "error", error: "This repository took too long to analyse." })], { close: true }))),
    /took too long/,
  );
});

test("a stream that ends without a result is an error", async () => {
  await assert.rejects(
    consumeAnalysisStream({}, () => {}, options(fakeFetch([sse({ type: "progress", phase: "parsing", detail: "x" })], { close: true }))),
    /ended before a result/,
  );
});

test("a stream that goes silent (open, no events) fails with a timeout error instead of hanging", async () => {
  const started = Date.now();
  await assert.rejects(
    consumeAnalysisStream({}, () => {}, options(fakeFetch([sse({ type: "progress", phase: "parsing", detail: "x" })], { close: false }), 80)),
    /stopped responding|too long/,
  );
  assert.ok(Date.now() - started < 2000);
});

test("progress events keep resetting the idle timer", async () => {
  const fetchImpl = (async () => {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < 4; i++) {
          controller.enqueue(sse({ type: "progress", phase: "parsing", detail: String(i) }));
          await new Promise((r) => setTimeout(r, 50));
        }
        controller.enqueue(sse({ type: "result", shareUrl: "/repo/2", ownerToken: "t", expiresAt: null }));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
  const result = await consumeAnalysisStream({}, () => {}, options(fetchImpl, 120));
  assert.equal(result.shareUrl, "/repo/2");
});

test("a caller abort propagates as an AbortError", async () => {
  const controller = new AbortController();
  const p = consumeAnalysisStream({}, () => {}, { fetchImpl: fakeFetch([], { close: false }), idleTimeoutMs: 5000, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(p, (e: unknown) => e instanceof DOMException && e.name === "AbortError");
});

test("a request that never gets a response (hang before the first byte) fails with an idle error", async () => {
  const hanging = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  const started = Date.now();
  await assert.rejects(consumeAnalysisStream({}, () => {}, options(hanging, 80)), /stopped responding/);
  assert.ok(Date.now() - started < 2000);
});

test("a stalled reader.cancel() cannot delay the idle error", async () => {
  const fetchImpl = (async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(sse({ type: "progress", phase: "parsing", detail: "x" })); },
      cancel: () => new Promise<void>(() => {}), // never settles, like a dead socket
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
  const started = Date.now();
  await assert.rejects(consumeAnalysisStream({}, () => {}, options(fetchImpl, 80)), /stopped responding/);
  assert.ok(Date.now() - started < 1500);
});

test("the default idle timeout is longer than the server's analysis budget", async () => {
  const { STREAM_IDLE_TIMEOUT_MS } = await import("@/lib/client/analysisStream");
  const { ANALYSIS_BUDGET_MS } = await import("@/lib/analysis/analyzeRepository");
  assert.ok(STREAM_IDLE_TIMEOUT_MS > ANALYSIS_BUDGET_MS);
  assert.ok(STREAM_IDLE_TIMEOUT_MS <= 300_000, "and still inside the function's maxDuration");
});
