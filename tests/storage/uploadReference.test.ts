import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { isValidUploadReference } from "../../lib/storage/uploadReference";

test("local upload references stay inside Cartograph's upload directory", () => {
  const uploadDir = path.join(tmpdir(), "cartograph-uploads");

  assert.equal(
    isValidUploadReference(path.join(uploadDir, "request-project.zip"), "local"),
    true,
  );
  assert.equal(isValidUploadReference(path.join(tmpdir(), "unrelated.zip"), "local"), false);
  assert.equal(isValidUploadReference(path.join(uploadDir, "..", "outside.zip"), "local"), false);
  assert.equal(isValidUploadReference(uploadDir, "local"), false);
});

test("Blob upload references require Cartograph's public upload namespace", () => {
  assert.equal(
    isValidUploadReference(
      "https://store.public.blob.vercel-storage.com/uploads/request/project-random.zip",
      "blob",
    ),
    true,
  );
  assert.equal(
    isValidUploadReference("https://example.com/uploads/request/project.zip", "blob"),
    false,
  );
  assert.equal(
    isValidUploadReference(
      "https://store.public.blob.vercel-storage.com/analyses/result.json",
      "blob",
    ),
    false,
  );
  assert.equal(
    isValidUploadReference(
      "http://store.public.blob.vercel-storage.com/uploads/request/project.zip",
      "blob",
    ),
    false,
  );
});

test("malformed upload references are rejected", () => {
  assert.equal(isValidUploadReference("", "local"), false);
  assert.equal(isValidUploadReference("not a URL", "blob"), false);
});
