import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GoParser } from "@/lib/analysis/parsers/go/parser";
import { buildRepositoryIR } from "@/lib/analysis/ir/bridge";

test("Go parser extracts imports, declarations, and representative package edges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-go-"));
  try {
    await mkdir(path.join(root, "pkg"));
    await writeFile(path.join(root, "go.mod"), "module example.com/demo\n");
    await writeFile(
      path.join(root, "main.go"),
      'package main\nimport ("fmt"; "example.com/demo/pkg")\nfunc main() { fmt.Println(pkg.Value) }\n',
    );
    await writeFile(path.join(root, "pkg", "a.go"), "package pkg\ntype Thing struct{}\nfunc F() {}\n");
    await writeFile(path.join(root, "pkg", "b.go"), "package pkg\nvar Value = 1\n");

    const files = [
      { absolutePath: path.join(root, "main.go"), relativePath: "main.go" },
      { absolutePath: path.join(root, "pkg", "a.go"), relativePath: "pkg/a.go" },
      { absolutePath: path.join(root, "pkg", "b.go"), relativePath: "pkg/b.go" },
    ];
    const parser = new GoParser();
    await parser.initialize({ projectRoot: root, discoveredFiles: files });

    const main = parser.parseFile(files[0], await readFile(files[0].absolutePath, "utf8"));
    assert.deepEqual(main.internalImports, ["fmt", "example.com/demo/pkg"]);
    assert.equal(main.parseErrors.length, 0);
    assert.ok(main.declarations?.some((declaration) => declaration.name === "main"));

    assert.deepEqual(parser.resolveImport("fmt", files[0], files), {
      resolved: null,
      raw: "fmt",
      unresolvedKind: "external",
    });
    assert.deepEqual(parser.resolveImport("example.com/demo/pkg", files[0], files), {
      resolved: "pkg/a.go",
      raw: "example.com/demo/pkg",
      approximate: true,
    });
    assert.equal(parser.rootConfidence, "declared");
    parser.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Go representative imports retain heuristic provenance in the IR", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-go-ir-"));
  try {
    await writeFile(path.join(root, "go.mod"), "module example.com/demo\n");
    const ir = buildRepositoryIR(root, [
      {
        path: "main.go",
        lineCount: 2,
        internalImports: ["pkg/a.go"],
        approximateInternalImports: ["pkg/a.go"],
        externalImports: [],
        parseErrors: [],
        capabilitiesUsed: ["imports"],
      },
      {
        path: "pkg/a.go",
        lineCount: 1,
        internalImports: [],
        externalImports: [],
        parseErrors: [],
        capabilitiesUsed: ["imports"],
      },
    ]);
    assert.ok(ir);
    const dependency = ir.edges.find((edge) => edge.kind === "imports");
    assert.equal(dependency?.provenance.origin, "heuristic");
    assert.match(dependency?.provenance.note ?? "", /representative file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
