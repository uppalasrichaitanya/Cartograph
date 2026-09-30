import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadGithubArchive, GithubImportError } from "@/lib/github/download";

const source = { owner: "octo", repo: "cat", ref: null };
type Fetch = typeof fetch;

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-gh-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A fetch that answers each call from a queue and records the requests. */
function scripted(responses: Array<Response | (() => Response)>): { fetchImpl: Fetch; urls: string[]; inits: RequestInit[] } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    inits.push(init ?? {});
    const next = responses[index++];
    if (!next) throw new Error("unexpected extra request");
    return typeof next === "function" ? next() : next;
  }) as Fetch;
  return { fetchImpl, urls, inits };
}

function rejectsWith(message: RegExp) {
  return (error: unknown) => error instanceof GithubImportError && message.test(error.message);
}

test("download writes the archive and requests codeload HEAD with manual redirects", async () => {
  await withDir(async (dir) => {
    const dest = path.join(dir, "a.zip");
    const { fetchImpl, urls, inits } = scripted([new Response(new Uint8Array([1, 2, 3, 4]))]);
    const result = await downloadGithubArchive(source, dest, { fetchImpl });
    assert.equal(result.bytes, 4);
    assert.deepEqual([...(await readFile(dest))], [1, 2, 3, 4]);
    assert.deepEqual(urls, ["https://codeload.github.com/octo/cat/zip/HEAD"]);
    assert.equal(inits[0].redirect, "manual");
  });
});

test("download encodes each segment of a ref and keeps the slashes", async () => {
  await withDir(async (dir) => {
    const { fetchImpl, urls } = scripted([new Response(new Uint8Array([1]))]);
    await downloadGithubArchive({ ...source, ref: "feat/a+b" }, path.join(dir, "a.zip"), { fetchImpl });
    assert.deepEqual(urls, ["https://codeload.github.com/octo/cat/zip/feat/a%2Bb"]);
  });
});

test("404 gives the friendly private-repository message", async () => {
  await withDir(async (dir) => {
    const { fetchImpl } = scripted([new Response("nope", { status: 404 })]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }),
      rejectsWith(/Couldn't find a public GitHub repository at octo\/cat\. Private repositories aren't supported\. Upload a zip instead\./),
    );
  });
});

test("404 with a ref mentions the branch or tag", async () => {
  await withDir(async (dir) => {
    const { fetchImpl } = scripted([new Response("nope", { status: 404 })]);
    await assert.rejects(
      downloadGithubArchive({ ...source, ref: "dev" }, path.join(dir, "a.zip"), { fetchImpl }),
      rejectsWith(/branch or tag "dev"/),
    );
  });
});

test("other non-2xx statuses get the generic message", async () => {
  await withDir(async (dir) => {
    const { fetchImpl } = scripted([new Response("x", { status: 503 })]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }),
      rejectsWith(/GitHub didn't return the archive \(status 503\)\. Try again in a minute, or upload a zip\./),
    );
  });
});

test("redirects to an allowed host are followed, relative ones resolve against the current URL", async () => {
  await withDir(async (dir) => {
    const dest = path.join(dir, "a.zip");
    const { fetchImpl, urls } = scripted([
      redirect("https://github.com/octo/cat/archive/HEAD.zip", 301),
      redirect("/octo/cat/zip/HEAD", 302),
      new Response(new Uint8Array([9])),
    ]);
    const result = await downloadGithubArchive(source, dest, { fetchImpl });
    assert.equal(result.bytes, 1);
    assert.deepEqual(urls, [
      "https://codeload.github.com/octo/cat/zip/HEAD",
      "https://github.com/octo/cat/archive/HEAD.zip",
      "https://github.com/octo/cat/zip/HEAD",
    ]);
  });
});

test("a redirect to another host, http, a port, credentials or no location is rejected", async () => {
  for (const location of [
    "https://evil.example/x.zip",
    "https://github.com.evil.example/x.zip",
    "http://codeload.github.com/octo/cat/zip/HEAD",
    "https://codeload.github.com:8443/x.zip",
    "https://user:pw@codeload.github.com/x.zip",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
  ]) {
    await withDir(async (dir) => {
      const { fetchImpl, urls } = scripted([redirect(location)]);
      await assert.rejects(
        downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }),
        rejectsWith(/unexpected address/i),
        location,
      );
      assert.equal(urls.length, 1, `must not follow ${location}`);
    });
  }
  await withDir(async (dir) => {
    const { fetchImpl } = scripted([new Response(null, { status: 302 })]);
    await assert.rejects(downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }), rejectsWith(/unexpected address/i));
  });
});

test("more than 3 redirects is rejected", async () => {
  await withDir(async (dir) => {
    const hop = () => redirect("https://codeload.github.com/octo/cat/zip/HEAD");
    const { fetchImpl, urls } = scripted([hop, hop, hop, hop, new Response(new Uint8Array([1]))]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }),
      rejectsWith(/too many redirects/i),
    );
    assert.equal(urls.length, 4);
  });
});

test("a declared content-length over the limit is rejected without reading the body", async () => {
  await withDir(async (dir) => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new Uint8Array(4));
      },
    }, { highWaterMark: 0 });
    const { fetchImpl } = scripted([new Response(body, { headers: { "content-length": "100" } })]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl, maxBytes: 50 }),
      rejectsWith(/larger than \d+ (MB|bytes)\. Zip only its source folders/),
    );
    assert.equal(pulled, false, "body must not be consumed");
  });
});

test("a streamed body over the limit is aborted, whatever content-length says", async () => {
  await withDir(async (dir) => {
    const dest = path.join(dir, "a.zip");
    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(30));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    // No content-length: chunked, exactly like codeload.
    const { fetchImpl } = scripted([new Response(body)]);
    await assert.rejects(
      downloadGithubArchive(source, dest, { fetchImpl, maxBytes: 100 }),
      rejectsWith(/larger than \d+ (MB|bytes)\. Zip only its source folders/),
    );
    assert.equal(cancelled, true);
    assert.ok(chunks < 10, "must stop reading soon after the cap");
    await assert.rejects(stat(dest), "no partial archive is left behind");
  });
});

test("a lying content-length that undercounts is still capped while streaming", async () => {
  await withDir(async (dir) => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(60));
      },
    }, { highWaterMark: 0 });
    const { fetchImpl } = scripted([new Response(body, { headers: { "content-length": "10" } })]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl, maxBytes: 100 }),
      rejectsWith(/larger than \d+ (MB|bytes)\. Zip only its source folders/),
    );
  });
});

test("a stalled download times out", async () => {
  await withDir(async (dir) => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason ?? new DOMException("aborted", "AbortError")));
      })) as Fetch;
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl, timeoutMs: 30 }),
      rejectsWith(/took too long/),
    );
  });
});

test("a body that stalls mid-stream times out", async () => {
  await withDir(async (dir) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      pull: () => new Promise(() => {}),
    });
    const { fetchImpl } = scripted([new Response(body)]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl, timeoutMs: 30 }),
      rejectsWith(/took too long/),
    );
  });
});

test("a caller abort propagates as an abort, not a GitHub error", async () => {
  await withDir(async (dir) => {
    const controller = new AbortController();
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as Fetch;
    const pending = downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => !(error instanceof GithubImportError));
  });
});

test("a network failure becomes a friendly error", async () => {
  await withDir(async (dir) => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as Fetch;
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }),
      rejectsWith(/Couldn't reach GitHub/),
    );
  });
});

test("a local write failure is reported as such, not as a GitHub outage", async () => {
  await withDir(async (dir) => {
    const { fetchImpl } = scripted([new Response(new Uint8Array([1, 2]))]);
    await assert.rejects(
      downloadGithubArchive(source, path.join(dir, "missing-dir", "a.zip"), { fetchImpl }),
      rejectsWith(/Couldn't save the downloaded archive/),
    );
  });
});

test("redirect and 404 response bodies are cancelled", async () => {
  await withDir(async (dir) => {
    let cancelled = 0;
    const tracked = (status: number, headers: Record<string, string> = {}) => () =>
      new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status, headers });
    const { fetchImpl } = scripted([
      tracked(302, { location: "https://codeload.github.com/x" }),
      tracked(404),
    ]);
    await assert.rejects(downloadGithubArchive(source, path.join(dir, "a.zip"), { fetchImpl }), rejectsWith(/Couldn't find/));
    assert.equal(cancelled, 2);
  });
});
