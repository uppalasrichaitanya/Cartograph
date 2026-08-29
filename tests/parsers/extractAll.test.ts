import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extractAll, toLegacyResult } from "@/lib/analysis/extractAll";
import { ParserRegistry } from "@/lib/analysis/parsers/registry";
import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";
import { extractImports } from "@/lib/analysis/extractImports";
import type { ParseFileInput } from "@/lib/analysis/parsers/interface";
import type { ProjectFile } from "@/lib/analysis/resolveAliases";

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

/**
 * Create a ParserRegistry with a TypeScriptParser pre-registered.
 */
function createTsRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new TypeScriptParser());
  return registry;
}

// ---------------------------------------------------------------------------
// Full Extraction with TS Parser
// ---------------------------------------------------------------------------

test("extractAll — full extraction with TS parser", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-"));
  try {
    // Set up a project with imports, aliases, re-exports
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    await writeFile(
      path.join(root, "src", "entry.ts"),
      'import { helper } from "@/lib/helper";\nexport { helper } from "@/lib/helper";\n',
    );
    await writeFile(
      path.join(root, "src", "lib", "helper.ts"),
      'import React from "react";\nexport const helper = 1;\n',
    );

    const discoveredFiles = [
      fileInput(root, "src/entry.ts"),
      fileInput(root, "src/lib/helper.ts"),
    ];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);

      await t.test("produces correct number of extractions", () => {
        assert.equal(result.extractions.length, 2);
        assert.equal(result.skippedFiles.length, 0);
      });

      await t.test("entry.ts has resolved internal import", () => {
        const entry = result.extractions.find((e) => e.path === "src/entry.ts");
        assert.ok(entry, "entry.ts extraction should exist");
        assert.deepEqual([...entry.internalImports], ["src/lib/helper.ts"]);
        assert.deepEqual([...entry.externalImports], []);
        assert.deepEqual(entry.parseErrors, []);
      });

      await t.test("helper.ts has external import", () => {
        const helper = result.extractions.find((e) => e.path === "src/lib/helper.ts");
        assert.ok(helper, "helper.ts extraction should exist");
        assert.deepEqual([...helper.internalImports], []);
        assert.deepEqual([...helper.externalImports], ["react"]);
        assert.deepEqual(helper.parseErrors, []);
      });

      await t.test("lineCount is correct", () => {
        const entry = result.extractions.find((e) => e.path === "src/entry.ts");
        assert.ok(entry);
        // "import...\nexport...\n" = 3 lines (trailing newline)
        assert.equal(entry.lineCount, 3);
      });
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Skipped Files (Unsupported Extension)
// ---------------------------------------------------------------------------

test("extractAll — unsupported extension → skippedFiles", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-skip-"));
  try {
    await writeFile(path.join(root, "main.py"), 'import os\nprint("hello")\n');
    await writeFile(path.join(root, "index.ts"), 'export const x = 1;\n');

    const discoveredFiles = [
      fileInput(root, "index.ts"),
      fileInput(root, "main.py"),
    ];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);

      await t.test("parseable file is extracted", () => {
        assert.equal(result.extractions.length, 1);
        assert.equal(result.extractions[0].path, "index.ts");
      });

      await t.test("unsupported extension is in skippedFiles", () => {
        assert.equal(result.skippedFiles.length, 1);
        assert.equal(result.skippedFiles[0].relativePath, "main.py");
      });
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Empty File List
// ---------------------------------------------------------------------------

test("extractAll — empty file list → valid empty result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-empty-"));
  try {
    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles: [] });

    try {
      const result = await extractAll(root, [], registry);
      assert.equal(result.extractions.length, 0);
      assert.equal(result.skippedFiles.length, 0);
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mix of Parseable and Unparseable Files
// ---------------------------------------------------------------------------

test("extractAll — mix of parseable and unparseable files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-mix-"));
  try {
    await writeFile(path.join(root, "valid.ts"), 'export const x = 1;\n');
    await writeFile(path.join(root, "broken.ts"), 'export const fn = (: string) => {};\n');

    const discoveredFiles = [
      fileInput(root, "broken.ts"),
      fileInput(root, "valid.ts"),
    ];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);

      await t.test("both files produce extractions", () => {
        assert.equal(result.extractions.length, 2);
      });

      await t.test("broken file has parseErrors", () => {
        const broken = result.extractions.find((e) => e.path === "broken.ts");
        assert.ok(broken);
        assert.ok(broken.parseErrors.length > 0);
        assert.deepEqual([...broken.internalImports], []);
        assert.deepEqual([...broken.externalImports], []);
      });

      await t.test("valid file has no parseErrors", () => {
        const valid = result.extractions.find((e) => e.path === "valid.ts");
        assert.ok(valid);
        assert.deepEqual(valid.parseErrors, []);
      });
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Legacy Adapter — toLegacyResult
// ---------------------------------------------------------------------------

test("toLegacyResult — converts to legacy SourceFileAnalysis shape", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-legacy-"));
  try {
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    await writeFile(
      path.join(root, "src", "entry.ts"),
      'import { helper } from "@/lib/helper";\nexport { helper } from "@/lib/helper";\n',
    );
    await writeFile(
      path.join(root, "src", "lib", "helper.ts"),
      "export const helper = 1;\n",
    );

    const discoveredFiles = [
      fileInput(root, "src/entry.ts"),
      fileInput(root, "src/lib/helper.ts"),
    ];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);
      const legacy = toLegacyResult(result);

      await t.test("produces SourceFileAnalysis entries", () => {
        assert.equal(legacy.files.length, 2);
        assert.equal(legacy.parseErrors.length, 0);
      });

      await t.test("entry.ts has correct imports", () => {
        const entry = legacy.files.find((f) => f.filePath === "src/entry.ts");
        assert.ok(entry);
        assert.deepEqual(entry.imports, ["src/lib/helper.ts"]);
        assert.deepEqual(entry.externalImports, []);
      });

      await t.test("helper.ts has correct shape", () => {
        const helper = legacy.files.find((f) => f.filePath === "src/lib/helper.ts");
        assert.ok(helper);
        assert.deepEqual(helper.imports, []);
        assert.deepEqual(helper.externalImports, []);
      });
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("toLegacyResult — files with parse errors become ParseError entries", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-legacy-err-"));
  try {
    await writeFile(path.join(root, "broken.ts"), 'export const fn = (: string) => {};\n');

    const discoveredFiles = [fileInput(root, "broken.ts")];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);
      const legacy = toLegacyResult(result);

      await t.test("broken file becomes a ParseError", () => {
        assert.equal(legacy.files.length, 0);
        assert.equal(legacy.parseErrors.length, 1);
        assert.equal(legacy.parseErrors[0].filePath, "broken.ts");
        assert.ok(legacy.parseErrors[0].message.length > 0);
      });
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Behavioral Equivalence with Legacy extractImports
// ---------------------------------------------------------------------------

test("extractAll + toLegacyResult — produces identical output to legacy extractImports", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-equiv-"));
  try {
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    await writeFile(
      path.join(root, "src", "entry.ts"),
      'import { helper } from "@/lib/helper";\nexport { helper } from "@/lib/helper";\n',
    );
    await writeFile(
      path.join(root, "src", "lib", "helper.ts"),
      "export const helper = 1;\n",
    );

    // The legacy ProjectFile type has { absolutePath, filePath }
    // The new ParseFileInput has { absolutePath, relativePath }
    const legacyFiles: ProjectFile[] = [
      { absolutePath: path.join(root, "src", "entry.ts"), filePath: "src/entry.ts" },
      { absolutePath: path.join(root, "src", "lib", "helper.ts"), filePath: "src/lib/helper.ts" },
    ];
    const newFiles: ParseFileInput[] = [
      fileInput(root, "src/entry.ts"),
      fileInput(root, "src/lib/helper.ts"),
    ];

    // Run legacy pipeline
    const legacyResult = await extractImports(root, legacyFiles);

    // Run new pipeline
    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles: newFiles });
    try {
      const newResult = await extractAll(root, newFiles, registry);
      const legacyAdapted = toLegacyResult(newResult);

      await t.test("same number of files", () => {
        assert.equal(legacyAdapted.files.length, legacyResult.files.length);
      });

      await t.test("same number of parse errors", () => {
        assert.equal(legacyAdapted.parseErrors.length, legacyResult.parseErrors.length);
      });

      await t.test("entry.ts has identical imports", () => {
        const legacyEntry = legacyResult.files.find((f) => f.filePath === "src/entry.ts");
        const newEntry = legacyAdapted.files.find((f) => f.filePath === "src/entry.ts");
        assert.ok(legacyEntry);
        assert.ok(newEntry);
        assert.deepEqual(newEntry.imports, legacyEntry.imports);
        assert.deepEqual(newEntry.externalImports, legacyEntry.externalImports);
      });

      await t.test("helper.ts has identical imports", () => {
        const legacyHelper = legacyResult.files.find((f) => f.filePath === "src/lib/helper.ts");
        const newHelper = legacyAdapted.files.find((f) => f.filePath === "src/lib/helper.ts");
        assert.ok(legacyHelper);
        assert.ok(newHelper);
        assert.deepEqual(newHelper.imports, legacyHelper.imports);
        assert.deepEqual(newHelper.externalImports, legacyHelper.externalImports);
      });

      await t.test("lineCount matches", () => {
        for (const legacyFile of legacyResult.files) {
          const newFile = legacyAdapted.files.find((f) => f.filePath === legacyFile.filePath);
          assert.ok(newFile, `Should find ${legacyFile.filePath}`);
          assert.equal(newFile.lineCount, legacyFile.lineCount, `lineCount mismatch for ${legacyFile.filePath}`);
        }
      });
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// File Read Errors
// ---------------------------------------------------------------------------

test("extractAll — unreadable file produces extraction with parse error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-unread-"));
  try {
    // Point to a file that doesn't exist on disk
    const discoveredFiles = [fileInput(root, "nonexistent.ts")];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);

      assert.equal(result.extractions.length, 1);
      assert.equal(result.skippedFiles.length, 0);

      const extraction = result.extractions[0];
      assert.equal(extraction.path, "nonexistent.ts");
      assert.ok(extraction.parseErrors.length > 0);
      assert.equal(extraction.parseErrors[0].severity, "fatal");
      assert.equal(extraction.parseErrors[0].reason, "unreadable");
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Deterministic Ordering
// ---------------------------------------------------------------------------

test("extractAll — extractions preserve input file order", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-extractall-order-"));
  try {
    await writeFile(path.join(root, "b.ts"), "export const b = 2;\n");
    await writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "c.ts"), "export const c = 3;\n");

    // Deliberately provide files in non-alphabetical order
    const discoveredFiles = [
      fileInput(root, "b.ts"),
      fileInput(root, "a.ts"),
      fileInput(root, "c.ts"),
    ];

    const registry = createTsRegistry();
    await registry.initializeAll({ projectRoot: root, discoveredFiles });

    try {
      const result = await extractAll(root, discoveredFiles, registry);

      // Output order must match input order
      assert.equal(result.extractions[0].path, "b.ts");
      assert.equal(result.extractions[1].path, "a.ts");
      assert.equal(result.extractions[2].path, "c.ts");
    } finally {
      registry.disposeAll();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
