import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";
import type { ParseFileInput, ParserInitContext } from "@/lib/analysis/parsers/interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a ParseFileInput from a project root and relative path.
 */
function fileInput(projectRoot: string, relativePath: string): ParseFileInput {
  return {
    absolutePath: path.join(projectRoot, relativePath.split("/").join(path.sep)),
    relativePath,
  };
}

// ---------------------------------------------------------------------------
// Parser Properties
// ---------------------------------------------------------------------------

test("TypeScriptParser — properties", async (t) => {
  const parser = new TypeScriptParser();

  await t.test("has correct id, name, language", () => {
    assert.equal(parser.id, "typescript");
    assert.equal(parser.name, "TypeScript/JavaScript");
    assert.equal(parser.language, "typescript");
  });

  await t.test("declares correct extensions", () => {
    assert.deepEqual([...parser.extensions], ["ts", "tsx", "js", "jsx"]);
  });

  await t.test("declares imports capability", () => {
    assert.deepEqual([...parser.capabilities], ["imports", "declarations"]);
  });

  await t.test("canHandle returns true for TS/JS extensions", () => {
    assert.equal(parser.canHandle("ts"), true);
    assert.equal(parser.canHandle("tsx"), true);
    assert.equal(parser.canHandle("js"), true);
    assert.equal(parser.canHandle("jsx"), true);
  });

  await t.test("canHandle returns false for non-TS extensions", () => {
    assert.equal(parser.canHandle("py"), false);
    assert.equal(parser.canHandle("go"), false);
    assert.equal(parser.canHandle("rs"), false);
    assert.equal(parser.canHandle(""), false);
  });
});

// ---------------------------------------------------------------------------
// parseFile — Basic Parsing
// ---------------------------------------------------------------------------

test("TypeScriptParser — parseFile basics", async (t) => {
  const parser = new TypeScriptParser();

  await t.test("parse a simple .ts file with imports", () => {
    const file = fileInput("/project", "src/index.ts");
    const content = [
      'import { helper } from "./lib/helper";',
      'import React from "react";',
      "",
      "export const main = () => helper();",
    ].join("\n");

    const result = parser.parseFile(file, content);
    assert.equal(result.path, "src/index.ts");
    assert.equal(result.lineCount, 4);
    assert.deepEqual(result.parseErrors, []);
    assert.deepEqual([...result.capabilitiesUsed], ["imports", "declarations"]);
    // Both specifiers should be in internalImports at parse time
    // (resolution happens later via resolveImport)
    assert.ok(result.internalImports.includes("./lib/helper"));
    assert.ok(result.internalImports.includes("react"));
  });

  await t.test("parse a .tsx file with JSX", () => {
    const file = fileInput("/project", "components/App.tsx");
    const content = [
      'import React from "react";',
      "",
      "export const App = () => <div>Hello</div>;",
    ].join("\n");

    const result = parser.parseFile(file, content);
    assert.equal(result.path, "components/App.tsx");
    assert.equal(result.lineCount, 3);
    assert.deepEqual(result.parseErrors, []);
    assert.ok(result.internalImports.includes("react"));
  });

  await t.test("parse a .js file", () => {
    const file = fileInput("/project", "lib/util.js");
    const content = [
      'const fs = require("fs");',
      'import path from "path";',
      "",
      "module.exports = { path };",
    ].join("\n");

    const result = parser.parseFile(file, content);
    assert.equal(result.path, "lib/util.js");
    assert.equal(result.lineCount, 4);
    assert.deepEqual(result.parseErrors, []);
    // Only static import/export declarations are captured, not require()
    assert.ok(result.internalImports.includes("path"));
    assert.equal(result.internalImports.length, 1);
  });

  await t.test("file with no imports → valid RawExtraction with empty imports", () => {
    const file = fileInput("/project", "src/constants.ts");
    const content = "export const PI = 3.14159;\nexport const E = 2.71828;\n";

    const result = parser.parseFile(file, content);
    assert.equal(result.path, "src/constants.ts");
    assert.equal(result.lineCount, 3);
    assert.deepEqual([...result.internalImports], []);
    assert.deepEqual([...result.externalImports], []);
    assert.deepEqual(result.parseErrors, []);
  });

  await t.test("re-exports are captured", () => {
    const file = fileInput("/project", "src/barrel.ts");
    const content = [
      'export { helper } from "./lib/helper";',
      'export { utils } from "./lib/utils";',
      'export * from "./lib/types";',
    ].join("\n");

    const result = parser.parseFile(file, content);
    assert.equal(result.internalImports.length, 3);
    assert.ok(result.internalImports.includes("./lib/helper"));
    assert.ok(result.internalImports.includes("./lib/utils"));
    assert.ok(result.internalImports.includes("./lib/types"));
  });

  await t.test("deduplicates specifiers from same module", () => {
    const file = fileInput("/project", "src/multi.ts");
    const content = [
      'import { a } from "./lib/helper";',
      'import { b } from "./lib/helper";',
      'export { c } from "./lib/helper";',
    ].join("\n");

    const result = parser.parseFile(file, content);
    // Set deduplication — "./lib/helper" appears only once
    const helperCount = result.internalImports.filter((s) => s === "./lib/helper").length;
    assert.equal(helperCount, 1);
  });
});

// ---------------------------------------------------------------------------
// parseFile — Error Handling
// ---------------------------------------------------------------------------

test("TypeScriptParser — parseFile error handling", async (t) => {
  const parser = new TypeScriptParser();

  await t.test("file with syntax errors → parseErrors populated, empty imports", () => {
    const file = fileInput("/project", "src/broken.ts");
    const content = [
      'import { helper } from "./lib/helper";',
      "",
      "export const fn = () => {",
      "  // missing closing brace and paren",
    ].join("\n");

    const result = parser.parseFile(file, content);
    assert.equal(result.path, "src/broken.ts");
    // When TS reports diagnostics, we return empty imports (matches legacy behavior)
    assert.deepEqual([...result.internalImports], []);
    assert.deepEqual([...result.externalImports], []);
    assert.ok(result.parseErrors.length > 0, "Should have parse errors");
  });

  await t.test("IRParseError has severity and reason", () => {
    const file = fileInput("/project", "src/broken.ts");
    const content = "export const fn = (: string) => {};";

    const result = parser.parseFile(file, content);
    assert.ok(result.parseErrors.length > 0);
    const firstError = result.parseErrors[0];
    assert.equal(firstError.severity, "fatal");
    assert.equal(firstError.reason, "syntax");
    assert.ok(firstError.message.length > 0);
  });

  await t.test("IRParseError has line/column from TS diagnostics", () => {
    const file = fileInput("/project", "src/broken.ts");
    // Line 3 has a syntax error (unexpected token after the colon)
    const content = "const a = 1;\nconst b = 2;\nconst c = (:) => {};\n";

    const result = parser.parseFile(file, content);
    assert.ok(result.parseErrors.length > 0);
    const firstError = result.parseErrors[0];
    // Should have line and column info from the diagnostic
    assert.ok(firstError.line !== undefined, "Should have line number");
    assert.ok(firstError.column !== undefined, "Should have column number");
    assert.equal(firstError.line, 3); // Error is on line 3
  });

  await t.test("lineCount is still populated on error", () => {
    const file = fileInput("/project", "src/broken.ts");
    const content = "line1\nline2\nconst c = (:) => {};\nline4\n";

    const result = parser.parseFile(file, content);
    assert.equal(result.lineCount, 5);
  });
});

// ---------------------------------------------------------------------------
// resolveImport — With Real Filesystem
// ---------------------------------------------------------------------------

test("TypeScriptParser — resolveImport", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-ts-parser-test-"));
  const parser = new TypeScriptParser();

  try {
    // Create project structure
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    await writeFile(path.join(root, "src", "entry.ts"), 'import { helper } from "@/lib/helper";');
    await writeFile(path.join(root, "src", "lib", "helper.ts"), "export const helper = 1;");
    await writeFile(path.join(root, "src", "lib", "index.ts"), 'export * from "./helper";');
    await writeFile(path.join(root, "src", "relative.ts"), 'import { helper } from "./lib/helper";');

    // Build file list
    const knownFiles: ParseFileInput[] = [
      fileInput(root, "src/entry.ts"),
      fileInput(root, "src/lib/helper.ts"),
      fileInput(root, "src/lib/index.ts"),
      fileInput(root, "src/relative.ts"),
    ];

    // Initialize the parser
    const context: ParserInitContext = {
      projectRoot: root,
      discoveredFiles: knownFiles,
    };
    await parser.initialize(context);

    await t.test("resolves tsconfig alias (@/) to project file", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("@/lib/helper", fromFile, knownFiles);
      assert.equal(result.resolved, "src/lib/helper.ts");
      assert.equal(result.raw, "@/lib/helper");
    });

    await t.test("resolves relative import to project file", () => {
      const fromFile = fileInput(root, "src/relative.ts");
      const result = parser.resolveImport("./lib/helper", fromFile, knownFiles);
      assert.equal(result.resolved, "src/lib/helper.ts");
      assert.equal(result.raw, "./lib/helper");
    });

    await t.test("resolves directory import to index file", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("./lib", fromFile, knownFiles);
      assert.equal(result.resolved, "src/lib/index.ts");
      assert.equal(result.raw, "./lib");
    });

    await t.test("external import returns resolved: null", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("react", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.raw, "react");
    });

    await t.test("unknown local path returns resolved: null", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("./does/not/exist", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.raw, "./does/not/exist");
    });

    // -----------------------------------------------------------------------
    // Phase 0.5 — unresolvedKind classification (parity with the Python parser)
    //
    // A specifier beginning with './', '../' or '/' cannot denote an npm
    // package: the syntax alone rules it out, independent of any config. When
    // such a specifier fails lookup, the honest answer is "internal reference
    // whose target is unknown", not "external dependency".
    // -----------------------------------------------------------------------

    await t.test("genuine external import is classified external", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("react", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "external");
    });

    await t.test("scoped package name is classified external", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("@scope/pkg", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "external");
    });

    await t.test("broken relative import is unresolved-internal, not external", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("./does/not/exist", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "unresolved-internal");
    });

    await t.test("broken parent-relative import is unresolved-internal", () => {
      const fromFile = fileInput(root, "src/lib/helper.ts");
      const result = parser.resolveImport("../gone", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "unresolved-internal");
    });

    await t.test("broken root-absolute import is unresolved-internal", () => {
      const fromFile = fileInput(root, "src/entry.ts");
      const result = parser.resolveImport("/src/gone", fromFile, knownFiles);
      assert.equal(result.resolved, null);
      assert.equal(result.unresolvedKind, "unresolved-internal");
    });

    await t.test("a resolved import carries no unresolvedKind", () => {
      const fromFile = fileInput(root, "src/relative.ts");
      const result = parser.resolveImport("./lib/helper", fromFile, knownFiles);
      assert.equal(result.resolved, "src/lib/helper.ts");
      assert.equal(result.unresolvedKind, undefined);
    });

    await t.test(
      "an alias-shaped specifier that does not resolve stays external",
      () => {
        // Deliberate: a tsconfig path alias may legitimately point at
        // node_modules, so a failed alias lookup is not proof of an internal
        // target. Only syntax-guaranteed-internal forms are reclassified.
        const fromFile = fileInput(root, "src/entry.ts");
        const result = parser.resolveImport("@/lib/gone", fromFile, knownFiles);
        assert.equal(result.resolved, null);
        assert.equal(result.unresolvedKind, "external");
      },
    );
  } finally {
    parser.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("TypeScriptParser — lifecycle", async (t) => {
  await t.test("dispose clears cached state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cartograph-ts-dispose-test-"));
    try {
      await writeFile(path.join(root, "index.ts"), "export const x = 1;");
      const parser = new TypeScriptParser();
      const knownFiles = [fileInput(root, "index.ts")];

      await parser.initialize({
        projectRoot: root,
        discoveredFiles: knownFiles,
      });

      // After dispose, resolveImport should return null (not initialized)
      parser.dispose();
      const result = parser.resolveImport("./index", fileInput(root, "main.ts"), knownFiles);
      assert.equal(result.resolved, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("parseFile works without initialize (parsing is stateless)", () => {
    const parser = new TypeScriptParser();
    const file = fileInput("/project", "src/index.ts");
    const content = 'import { x } from "./lib";';

    // parseFile should work even without initialize — parsing
    // doesn't need config. Only resolution does.
    const result = parser.parseFile(file, content);
    assert.equal(result.path, "src/index.ts");
    assert.ok(result.internalImports.includes("./lib"));
  });
});

// ---------------------------------------------------------------------------
// Behavioral Equivalence with Legacy Pipeline
// ---------------------------------------------------------------------------

test("TypeScriptParser — behavioral equivalence with legacy extractImports", async (t) => {
  await t.test("alias resolution produces identical results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cartograph-ts-equiv-test-"));
    try {
      await mkdir(path.join(root, "src", "lib"), { recursive: true });
      await writeFile(
        path.join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
      );
      await writeFile(
        path.join(root, "src", "entry.ts"),
        'import { helper } from "@/lib/helper"; export { helper } from "@/lib/helper";',
      );
      await writeFile(path.join(root, "src", "lib", "helper.ts"), "export const helper = 1;");

      const knownFiles = [
        fileInput(root, "src/entry.ts"),
        fileInput(root, "src/lib/helper.ts"),
      ];

      const parser = new TypeScriptParser();
      await parser.initialize({ projectRoot: root, discoveredFiles: knownFiles });

      // Parse the entry file
      const entryContent = 'import { helper } from "@/lib/helper"; export { helper } from "@/lib/helper";';
      const extraction = parser.parseFile(fileInput(root, "src/entry.ts"), entryContent);

      // Resolve each specifier — "@/lib/helper" should resolve to "src/lib/helper.ts"
      const resolved = extraction.internalImports.map((specifier) =>
        parser.resolveImport(specifier, fileInput(root, "src/entry.ts"), knownFiles),
      );

      // This matches the legacy extractImports result:
      // result.files[0].imports === ["src/lib/helper.ts"]
      const resolvedPaths = resolved
        .filter((r) => r.resolved !== null)
        .map((r) => r.resolved!)
        .sort();
      assert.deepEqual(resolvedPaths, ["src/lib/helper.ts"]);

      parser.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
