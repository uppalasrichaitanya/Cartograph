import assert from "node:assert/strict";
import test from "node:test";
import { AnalyzeRequestError, parseAnalyzeRequest } from "@/lib/api/analyzeRequest";

const badRequest = (pattern: RegExp) => (error: unknown) =>
  error instanceof AnalyzeRequestError && pattern.test(error.message);

test("a zip body keeps its existing shape and bounds", () => {
  const long = "x".repeat(300);
  const options = parseAnalyzeRequest({ zipPath: "/tmp/a.zip", repoName: `  ${long}  `, repoSizeBytes: 12, retention: "7d" });
  assert.equal(options.zipPath, "/tmp/a.zip");
  assert.equal(options.repoName, "x".repeat(120));
  assert.equal(options.repoSizeBytes, 12);
  assert.equal(options.retention, "7d");
  assert.equal(options.github, undefined);
});

test("a github body is parsed into a validated source, and client display metadata is ignored", () => {
  const options = parseAnalyzeRequest({
    github: "https://github.com/octo/cat/tree/dev",
    retention: "manual",
    repoName: "spoofed",
    repoSizeBytes: 1,
  });
  assert.deepEqual(options.github, { owner: "octo", repo: "cat", ref: "dev" });
  assert.equal(options.retention, "manual");
  assert.equal(options.zipPath, undefined);
  assert.equal(options.repoName, undefined);
  assert.equal(options.repoSizeBytes, undefined);
});

test("a bad github value is a 400 carrying the parser message", () => {
  assert.throws(() => parseAnalyzeRequest({ github: "not a link" }), badRequest(/owner\/repo/));
  assert.throws(() => parseAnalyzeRequest({ github: "https://evil.example/octo/cat" }), badRequest(/github\.com/));
  assert.throws(() => parseAnalyzeRequest({ github: 42 }), badRequest(/GitHub/));
});

test("both or neither source is rejected", () => {
  assert.throws(() => parseAnalyzeRequest({ zipPath: "/tmp/a.zip", github: "octo/cat" }), badRequest(/exactly one/i));
  assert.throws(() => parseAnalyzeRequest({ retention: "7d" }), badRequest(/exactly one/i));
  assert.throws(() => parseAnalyzeRequest({}), badRequest(/exactly one/i));
  assert.throws(() => parseAnalyzeRequest(null), badRequest(/JSON object/i));
  assert.throws(() => parseAnalyzeRequest("octo/cat"), badRequest(/JSON object/i));
});

test("a github value over 500 characters is rejected before parsing", () => {
  assert.throws(() => parseAnalyzeRequest({ github: `octo/${"a".repeat(600)}` }), badRequest(/too long/i));
});
