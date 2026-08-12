import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUploadPathname,
  UPLOAD_PREFIX,
  UNIQUE_UPLOAD_TOKEN_OPTIONS,
} from "../../lib/storage/uploadPathname";

/**
 * Minimal stand-in for Vercel Blob, modelling the two semantics that
 * matter for the upload lifecycle:
 *
 *   1. Objects are keyed by *pathname*, so two uploads that resolve to the
 *      same pathname are the same object.
 *   2. `put` rejects an existing pathname unless `allowOverwrite` is set
 *      (the @vercel/blob v1 default), and `del` removes the object, so a
 *      URL whose object was deleted stops resolving.
 */
const STORE_ORIGIN = "https://example.public.blob.vercel-storage.com";

class FakeBlobStore {
  private objects = new Map<string, string>();

  put(
    pathname: string,
    body: string,
    { allowOverwrite = false }: { allowOverwrite?: boolean } = {},
  ): { pathname: string; url: string } {
    if (this.objects.has(pathname) && !allowOverwrite) {
      throw new Error(`This blob already exists: ${pathname}`);
    }
    this.objects.set(pathname, body);
    return { pathname, url: `${STORE_ORIGIN}/${pathname}` };
  }

  /** Mirrors `fetch(blobUrl)` in analyzeRepository. */
  fetch(url: string): { ok: boolean; body: string | null } {
    const pathname = url.slice(`${STORE_ORIGIN}/`.length);
    const body = this.objects.get(pathname);
    return body === undefined ? { ok: false, body: null } : { ok: true, body };
  }

  /** Mirrors `del(blobUrl)` in BlobStorage.deleteUpload. */
  del(url: string): void {
    this.objects.delete(url.slice(`${STORE_ORIGIN}/`.length));
  }
}

test("buildUploadPathname - repeated uploads of the same file name never collide", () => {
  const fileName = "my-project.zip";
  const pathnames = new Set(
    Array.from({ length: 100 }, () => buildUploadPathname(fileName)),
  );
  assert.equal(pathnames.size, 100, "every upload must get its own pathname");
});

test("buildUploadPathname - keeps the .zip extension so token validation still passes", () => {
  // /api/upload-url rejects any pathname that does not end in .zip.
  assert.match(buildUploadPathname("my-project.zip"), /\.zip$/);
  assert.match(buildUploadPathname("MyProject.ZIP"), /\.ZIP$/);
  assert.match(buildUploadPathname("weird name (1).zip"), /\.zip$/);
});

test("buildUploadPathname - namespaces uploads and strips path separators", () => {
  const pathname = buildUploadPathname("my project/../etc.zip");
  assert.ok(
    pathname.startsWith(`${UPLOAD_PREFIX}/`),
    `expected the ${UPLOAD_PREFIX}/ prefix, got ${pathname}`,
  );
  // The caller-supplied name must not be able to climb out of the prefix
  // or forge another namespace (e.g. analyses/).
  assert.equal(pathname.split("/").length, 3);
  assert.doesNotMatch(pathname.split("/")[2], /[\\/]/);
});

test("client upload token forces a unique pathname server-side", () => {
  // The pathname arrives from the browser, so uniqueness cannot rely on the
  // client alone. The token Vercel Blob issues must add its own suffix and
  // must not permit clobbering an existing blob.
  assert.equal(UNIQUE_UPLOAD_TOKEN_OPTIONS.addRandomSuffix, true);
  assert.equal(UNIQUE_UPLOAD_TOKEN_OPTIONS.allowOverwrite, false);
});

test("regression: a filename-derived pathname reproduces the production failure", () => {
  // Pre-fix behaviour: UploadForm passed `file.name` straight through and the
  // token set no random suffix, so the pathname was fully deterministic.
  const legacyPathname = (fileName: string) => fileName;
  const store = new FakeBlobStore();
  const fileName = "my-project.zip";

  const first = store.put(legacyPathname(fileName), "archive-1");
  assert.equal(store.fetch(first.url).ok, true);
  // analyzeRepository's finally block deletes the upload after run 1.
  store.del(first.url);

  // Run 2 uploads the same project. It lands on the same pathname, so the
  // URL handed to analysis is the one run 1 already deleted...
  const second = store.put(legacyPathname(fileName), "archive-2");
  assert.equal(second.url, first.url, "same project reused the same Blob URL");

  // ...and an overlapping run 1 cleanup destroys run 2's archive, which is
  // what surfaced as "Failed to download the uploaded archive."
  store.del(first.url);
  assert.equal(
    store.fetch(second.url).ok,
    false,
    "the shared pathname let one request delete another's archive",
  );
});

test("cleanup of one upload cannot destroy another upload of the same project", () => {
  const store = new FakeBlobStore();
  const fileName = "my-project.zip";

  // Two requests upload the same project; the second starts while the first
  // is still analysing.
  const first = store.put(buildUploadPathname(fileName), "archive-1");
  const second = store.put(buildUploadPathname(fileName), "archive-2");
  assert.notEqual(first.url, second.url);

  // Request 1 finishes and runs its cleanup.
  store.del(first.url);

  // Request 2 must still be able to download its own archive.
  const downloaded = store.fetch(second.url);
  assert.equal(downloaded.ok, true, "the second upload must survive");
  assert.equal(downloaded.body, "archive-2", "and must be its own archive");
});

test("the same project can be uploaded and analysed repeatedly", () => {
  const store = new FakeBlobStore();
  const fileName = "my-project.zip";
  const seen = new Set<string>();

  for (let run = 1; run <= 5; run += 1) {
    // Upload must not be rejected as an existing blob.
    const upload = store.put(buildUploadPathname(fileName), `archive-${run}`);
    assert.equal(seen.has(upload.url), false, `run ${run} reused a Blob URL`);
    seen.add(upload.url);

    // Analysis downloads the exact URL the upload returned.
    const downloaded = store.fetch(upload.url);
    assert.equal(downloaded.ok, true, `run ${run} could not download its archive`);
    assert.equal(downloaded.body, `archive-${run}`);

    // Cleanup targets that upload only.
    store.del(upload.url);
  }
});
