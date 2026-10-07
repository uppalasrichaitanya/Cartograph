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
