import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDiagramOptions,
  diagramFilename,
  diagramQuery,
  DiagramOptionsError,
  parseDiagramOptions,
} from "@/lib/diagram/options";

const parse = (query: string) => parseDiagramOptions(new URLSearchParams(query));

test("defaults: repository, document, standard, light, measured notes", () => {
  const { options, format, download } = parse("");
  assert.deepEqual(options, defaultDiagramOptions("document"));
  assert.deepEqual(options.scope, { kind: "repository" });
  assert.equal(options.showExternal, true);
  assert.equal(format, "svg");
  assert.equal(download, false);
});

test("slide preset turns external packages off unless asked", () => {
  assert.equal(parse("preset=slide").options.showExternal, false);
  assert.equal(parse("preset=slide&external=1").options.showExternal, true);
});

test("every option round-trips through the query string", () => {
  const { options } = parse("scope=region:lib/ai&preset=slide&detail=overview&theme=print&bg=transparent&tests=1&external=0&notes=ai");
  assert.deepEqual(options, {
    scope: { kind: "region", id: "lib/ai" },
    preset: "slide",
    detail: "overview",
    theme: "print",
    background: "transparent",
    includeTests: true,
    showExternal: false,
    annotations: "measured+ai",
  });
  assert.deepEqual(parse(diagramQuery(options, "svg")).options, options);
});

test("unknown values are rejected with the accepted list", () => {
  assert.throws(() => parse("preset=poster"), (error: unknown) =>
    error instanceof DiagramOptionsError && /preset must be one of: document, slide/.test(error.message));
  assert.throws(() => parse("format=png"), DiagramOptionsError);
  assert.throws(() => parse("scope=region:"), DiagramOptionsError);
  assert.throws(() => parse(`scope=region:${"a".repeat(1001)}`), DiagramOptionsError);
});

test("filenames are slugged and never empty", () => {
  assert.equal(diagramFilename("My Repo (main)", "svg"), "my-repo-main-architecture.svg");
  assert.equal(diagramFilename("日本", "png"), "repository-architecture.png");
});
