import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";
import { PythonParser } from "@/lib/analysis/parsers/python/parser";
import { IRBuilder } from "@/lib/analysis/ir/builder";
import { validateFileNode, IRValidationError } from "@/lib/analysis/ir/validation";
import { parsePosition, serializePosition } from "@/lib/workspace/position";
import { buildSearchItems } from "@/lib/workspace/searchItems";
import { rankSearchItems } from "@/lib/workspace/search";
import type { DependencyGraph } from "@/types/graph";
import type { FileNode, RepositoryIR } from "@/lib/analysis/ir/types";

const file = (relativePath: string) => ({
  relativePath,
  absolutePath: path.resolve(relativePath),
});

test("TypeScript declarations cover nesting, members, types, and stable overload ordinals", () => {
  const parser = new TypeScriptParser();
  const content = [
    "function outer() {",
    "  const validate = async () => true;",
    "  function nested() {}",
    "}",
    "class Repository { constructor() {} load() {} }",
    "interface Store {}",
    "type Key = string;",
    "enum State { Ready }",
    "function repeated(value: string): string;",
    "function repeated(value: number): number;",
    "function repeated(value: unknown) { return value; }",
    "[1].map(() => 1);",
  ].join("\n");

  const first = parser.parseFile(file("src/sample.ts"), content);
  const second = parser.parseFile(file("src/sample.ts"), content);
  assert.deepEqual(first.declarations, second.declarations);
  assert.deepEqual(first.declarations?.map((d) => [d.kind, d.qualifiedName]), [
    ["function", "outer"],
    ["function", "outer.validate"],
    ["function", "outer.nested"],
    ["class", "Repository"],
    ["constructor", "Repository.constructor"],
    ["method", "Repository.load"],
    ["interface", "Store"],
    ["type", "Key"],
    ["enum", "State"],
    ["function", "repeated"],
    ["function", "repeated"],
    ["function", "repeated"],
  ]);

  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");
  const node = builder.buildFileNode(first, root);
  const repeatedIds = node.declarations!
    .filter((d) => d.qualifiedName === "repeated")
    .map((d) => d.id);
  assert.equal(new Set(repeatedIds).size, 3);

  const moved = parser.parseFile(file("src/sample.ts"), `\n\n${content}`);
  const movedNode = builder.buildFileNode(moved, root);
  assert.deepEqual(
    node.declarations?.map((d) => d.id),
    movedNode.declarations?.map((d) => d.id),
    "source positions do not participate in identity",
  );
});

test("Python declarations cover async functions, nesting, classes, constructors, and methods", async () => {
  const parser = new PythonParser();
  await parser.initialize({ projectRoot: process.cwd(), discoveredFiles: [] });
  try {
    const result = parser.parseFile(file("sample.py"), [
      "async def outer():",
      "    def validate():",
      "        pass",
      "class Repository:",
      "    def __init__(self):",
      "        pass",
      "    async def load(self):",
      "        def normalize():",
      "            pass",
    ].join("\n"));

    assert.deepEqual(result.declarations?.map((d) => [d.kind, d.qualifiedName]), [
      ["function", "outer"],
      ["function", "outer.validate"],
      ["class", "Repository"],
      ["constructor", "Repository.__init__"],
      ["method", "Repository.load"],
      ["function", "Repository.load.normalize"],
    ]);
  } finally {
    parser.dispose();
  }
});

test("recovered declarations inherit reduced provenance", () => {
  const parser = new TypeScriptParser();
  const raw = parser.parseFile(file("broken.ts"), "class Kept { load() {} }\nconst broken = ;");
  assert.ok(raw.parseErrors.length > 0);
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");
  const node = builder.buildFileNode(raw, root);
  assert.equal(node.declarations?.[0].provenance.origin, "heuristic");
});

test("symbol validation rejects malformed ranges and source-order regressions", () => {
  const parser = new TypeScriptParser();
  const raw = parser.parseFile(file("a.ts"), "function a() {}\nfunction b() {}");
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");
  const node = builder.buildFileNode(raw, root) as FileNode;
  const reversed = { ...node, declarations: [...node.declarations!].reverse() };
  assert.throws(() => validateFileNode(reversed, "file"), IRValidationError);
  const malformed = {
    ...node,
    declarations: [{ ...node.declarations![0], range: { start: { line: 2, column: 1 }, end: { line: 1, column: 1 } } }],
  };
  assert.throws(() => validateFileNode(malformed, "file"), IRValidationError);
});

test("symbol search requires a query and navigates with file and symbol identity", () => {
  const graph = {
    nodes: [{ id: "src/a.ts", path: "src/a.ts", folder: "src", lineCount: 2, imports: [], externalImports: [] }],
    edges: [],
  } as DependencyGraph;
  const ir = {
    irVersion: 1,
    generatedAt: "2026-08-29T00:00:00.000Z",
    roots: [],
    edges: [],
    nodes: [{
      id: "file-id", kind: "File", path: "src/a.ts", declarations: [{
        id: "symbol-id", name: "load", qualifiedName: "Repository.load", kind: "method",
        range: { start: { line: 2, column: 3 }, end: { line: 2, column: 12 } },
        provenance: { origin: "verified" },
      }],
    }],
  } as unknown as RepositoryIR;
  const items = buildSearchItems(graph, ir);
  assert.equal(rankSearchItems(items, "", 50).results.some((r) => r.item.kind === "symbol"), false);
  const result = rankSearchItems(items, "load", 50).results[0];
  assert.equal(result.item.kind, "symbol");
  assert.deepEqual(result.item.target, { kind: "symbol", fileId: "src/a.ts", symbolId: "symbol-id" });
});

test("symbol URL state round-trips and rejects stale or cross-file symbols", () => {
  const position = { region: "src", file: "src/a.ts", symbol: "s1", lens: null, camera: null } as const;
  const query = serializePosition(position);
  const owners = new Map([["s1", "src/a.ts"], ["s2", "src/b.ts"]]);
  assert.equal(
    parsePosition(new URLSearchParams(query), new Set(["src"]), new Set(["src/a.ts", "src/b.ts"]), owners).symbol,
    "s1",
  );
  assert.equal(
    parsePosition(new URLSearchParams("file=src%2Fa.ts&symbol=s2"), new Set(), new Set(["src/a.ts"]), owners).symbol,
    null,
  );
});
