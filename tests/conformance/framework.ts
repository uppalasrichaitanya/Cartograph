/**
 * Cartograph Parser Conformance Test Framework
 *
 * A language-agnostic framework for verifying that any LanguageParser
 * implementation correctly satisfies the parser contract.
 *
 * Design:
 *   - The framework knows nothing about any specific language.
 *   - Fixtures are language-specific data: files, manifests, and expectations.
 *   - The assertion model is shared: every parser is tested the same way.
 *   - Adding a new language parser requires only writing new fixtures, not
 *     new assertion logic.
 *
 * Usage:
 *   1. Define fixtures (ConformanceFixture[]) for a language.
 *   2. Call runConformanceSuite(parser, fixtures) from a test file.
 *   3. The framework creates a temporary project on disk, runs the parser
 *      through its full lifecycle, and asserts the expectations.
 *
 * Created as part of Milestone 2, Phase 6 (Conformance Test Framework).
 *
 * @module tests/conformance/framework
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { LanguageParser, ParseFileInput, ParserInitContext } from "@/lib/analysis/parsers/interface";
import { extractAll, toLegacyResult } from "@/lib/analysis/extractAll";
import { ParserRegistry } from "@/lib/analysis/parsers/registry";

// ---------------------------------------------------------------------------
// Fixture Types
// ---------------------------------------------------------------------------

/**
 * A single conformance test fixture.
 *
 * Describes a minimal project (files + manifests) and the expected
 * extraction behavior. Every parser must produce results that satisfy
 * these expectations when run through the full pipeline.
 */
export interface ConformanceFixture {
  /** Descriptive name for test output. */
  readonly name: string;
  /** Language this fixture targets (must match the parser's language). */
  readonly language: string;
  /**
   * Source files to create in the fixture project.
   * Paths are relative to the project root, using forward slashes.
   */
  readonly files: ReadonlyArray<{ path: string; content: string }>;
  /**
   * Manifest/config files (package.json, tsconfig.json, etc.) to create.
   * These are placed at the project root or the specified relative path.
   */
  readonly manifests?: ReadonlyArray<{ path: string; content: string }>;
  /** Expected extraction assertions. */
  readonly expected: ConformanceExpectation;
}

/**
 * Expected extraction behavior for a conformance fixture.
 *
 * All fields are optional except parsedFileCount. When a field is
 * omitted, the framework does not assert on that dimension — allowing
 * fixtures to test only the aspects they care about.
 */
export interface ConformanceExpectation {
  /** Expected number of successfully parsed files (no fatal errors). */
  readonly parsedFileCount: number;
  /**
   * Expected internal (project-local) imports per file.
   * Key: relative file path. Value: sorted array of resolved import paths.
   * If a file is missing from this map, its internal imports are not checked.
   */
  readonly imports?: Record<string, string[]>;
  /**
   * Expected external imports per file.
   * Key: relative file path. Value: sorted array of external specifiers.
   */
  readonly externalImports?: Record<string, string[]>;
  /**
   * Files expected to have parse errors.
   * Listed by relative file path.
   */
  readonly errorFiles?: string[];
  /**
   * Expected number of total extractions (including files with errors).
   * When omitted, defaults to the number of source files in the fixture.
   */
  readonly totalExtractionCount?: number;
}

// ---------------------------------------------------------------------------
// Framework Implementation
// ---------------------------------------------------------------------------

/**
 * Materialize a fixture's files and manifests into a temporary directory.
 * Returns the project root path.
 */
async function materializeFixture(fixture: ConformanceFixture): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `cartograph-conformance-`));

  // Write manifest files first (they may be at root level)
  for (const manifest of fixture.manifests ?? []) {
    const manifestPath = path.join(root, manifest.path.split("/").join(path.sep));
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, manifest.content);
  }

  // Write source files
  for (const file of fixture.files) {
    const filePath = path.join(root, file.path.split("/").join(path.sep));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
  }

  return root;
}

/**
 * Build ParseFileInput[] from a fixture's source files.
 */
function buildFileInputs(root: string, fixture: ConformanceFixture): ParseFileInput[] {
  return fixture.files.map((f) => ({
    absolutePath: path.join(root, f.path.split("/").join(path.sep)),
    relativePath: f.path,
  }));
}

/**
 * Run the conformance suite for a single parser against a set of fixtures.
 *
 * This is the main entry point for the conformance framework. Call it
 * from a test file with the parser under test and its fixtures:
 *
 * ```typescript
 * import { runConformanceSuite } from "./framework";
 * import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";
 * import { typescriptFixtures } from "./typescript.fixtures";
 *
 * runConformanceSuite(new TypeScriptParser(), typescriptFixtures);
 * ```
 *
 * For each fixture, the framework:
 *   1. Creates a temporary project on disk
 *   2. Creates a fresh ParserRegistry and registers the parser
 *   3. Runs the full pipeline: initialize → extractAll → dispose
 *   4. Asserts each dimension of the ConformanceExpectation
 *   5. Verifies the legacy adapter produces valid output
 *   6. Cleans up the temporary project
 *
 * @param parser   - The parser implementation to test
 * @param fixtures - Conformance fixtures for the parser's language
 */
export function runConformanceSuite(
  parser: LanguageParser,
  fixtures: ConformanceFixture[],
): void {
  for (const fixture of fixtures) {
    test(`Conformance [${parser.id}] — ${fixture.name}`, async (t) => {
      const root = await materializeFixture(fixture);
      const discoveredFiles = buildFileInputs(root, fixture);

      // -----------------------------------------------------------------
      // Assertion: Parser Metadata & Contract
      // -----------------------------------------------------------------
      await t.test("parser metadata and contract", () => {
        assert.ok(parser.id, "Parser must have an id");
        assert.ok(parser.name, "Parser must have a name");
        assert.equal(parser.language, fixture.language, `Parser language must be '${fixture.language}'`);
        assert.ok(parser.extensions.length > 0, "Parser must declare at least one extension");
        assert.ok(parser.capabilities.length > 0, "Parser must declare at least one capability");
      });

      // -----------------------------------------------------------------
      // Assertion: canHandle for fixture files
      // -----------------------------------------------------------------
      await t.test("canHandle supports fixture files", () => {
        const fixtureExtensions = new Set(
          fixture.files
            .map((f) => f.path.split(".").pop()?.toLowerCase())
            .filter((ext): ext is string => !!ext)
        );
        for (const ext of fixtureExtensions) {
          assert.ok(
            parser.canHandle(ext),
            `Parser must handle extension '.${ext}' used in fixture`,
          );
        }
      });

      const registry = new ParserRegistry();
      registry.register(parser);

      try {
        await registry.initializeAll({ projectRoot: root, discoveredFiles });

        const result = await extractAll(root, discoveredFiles, registry);

        // -----------------------------------------------------------------
        // Assertion: total extraction count
        // -----------------------------------------------------------------
        const expectedTotal = fixture.expected.totalExtractionCount ?? fixture.files.length;
        await t.test("extraction count", () => {
          assert.equal(
            result.extractions.length,
            expectedTotal,
            `Expected ${expectedTotal} extractions, got ${result.extractions.length}`,
          );
        });

        // -----------------------------------------------------------------
        // Assertion: parsed file count (files without fatal errors)
        // -----------------------------------------------------------------
        await t.test("parsed file count", () => {
          const errorPaths = new Set(fixture.expected.errorFiles ?? []);
          const parsedCount = result.extractions.filter(
            (e) => !errorPaths.has(e.path),
          ).length;
          assert.equal(
            parsedCount,
            fixture.expected.parsedFileCount,
            `Expected ${fixture.expected.parsedFileCount} successfully parsed files, got ${parsedCount}`,
          );
        });

        // -----------------------------------------------------------------
        // Assertion: internal imports per file
        // -----------------------------------------------------------------
        if (fixture.expected.imports) {
          await t.test("internal imports", () => {
            for (const [filePath, expectedImports] of Object.entries(fixture.expected.imports!)) {
              const extraction = result.extractions.find((e) => e.path === filePath);
              assert.ok(extraction, `Extraction not found for ${filePath}`);
              assert.deepEqual(
                [...extraction.internalImports].sort(),
                [...expectedImports].sort(),
                `Internal imports mismatch for ${filePath}`,
              );
            }
          });
        }

        // -----------------------------------------------------------------
        // Assertion: external imports per file
        // -----------------------------------------------------------------
        if (fixture.expected.externalImports) {
          await t.test("external imports", () => {
            for (const [filePath, expectedExternals] of Object.entries(fixture.expected.externalImports!)) {
              const extraction = result.extractions.find((e) => e.path === filePath);
              assert.ok(extraction, `Extraction not found for ${filePath}`);
              assert.deepEqual(
                [...extraction.externalImports].sort(),
                [...expectedExternals].sort(),
                `External imports mismatch for ${filePath}`,
              );
            }
          });
        }

        // -----------------------------------------------------------------
        // Assertion: error files
        // -----------------------------------------------------------------
        if (fixture.expected.errorFiles) {
          await t.test("error files", () => {
            for (const errorPath of fixture.expected.errorFiles!) {
              const extraction = result.extractions.find((e) => e.path === errorPath);
              assert.ok(extraction, `Extraction not found for error file ${errorPath}`);
              assert.ok(
                extraction.parseErrors.length > 0,
                `Expected parse errors for ${errorPath}, but got none`,
              );
            }
          });
        }

        // -----------------------------------------------------------------
        // Assertion: non-error files have no parse errors
        // -----------------------------------------------------------------
        await t.test("non-error files have no parse errors", () => {
          const errorPaths = new Set(fixture.expected.errorFiles ?? []);
          for (const extraction of result.extractions) {
            if (!errorPaths.has(extraction.path)) {
              assert.equal(
                extraction.parseErrors.length,
                0,
                `Unexpected parse errors in ${extraction.path}: ${extraction.parseErrors.map((e) => e.message).join("; ")}`,
              );
            }
          }
        });

        // -----------------------------------------------------------------
        // Assertion: legacy adapter produces valid output
        // -----------------------------------------------------------------
        await t.test("legacy adapter compatibility", () => {
          const legacy = toLegacyResult(result);

          // Successfully parsed files + parse error files = total
          assert.equal(
            legacy.files.length + legacy.parseErrors.length,
            result.extractions.length,
            "Legacy adapter should produce one entry per extraction",
          );

          // Every legacy file has required properties
          for (const file of legacy.files) {
            assert.ok(typeof file.filePath === "string", "filePath should be a string");
            assert.ok(typeof file.lineCount === "number", "lineCount should be a number");
            assert.ok(Array.isArray(file.imports), "imports should be an array");
            assert.ok(Array.isArray(file.externalImports), "externalImports should be an array");
          }
        });

        // -----------------------------------------------------------------
        // Assertion: deterministic ordering
        // -----------------------------------------------------------------
        await t.test("deterministic ordering", async () => {
          // Run the pipeline a second time and verify ordering is stable
          const result2 = await extractAll(root, discoveredFiles, registry);
          const paths1 = result.extractions.map((e) => e.path);
          const paths2 = result2.extractions.map((e) => e.path);
          assert.deepEqual(paths1, paths2, "Extraction ordering should be deterministic");
        });

        // -----------------------------------------------------------------
        // Assertion: capabilities usage
        // -----------------------------------------------------------------
        await t.test("capabilities usage", () => {
          for (const extraction of result.extractions) {
            for (const cap of extraction.capabilitiesUsed) {
              assert.ok(
                parser.capabilities.includes(cap),
                `Parser used capability '${cap}' not declared in its capabilities array`,
              );
            }
          }
        });
      } finally {
        registry.disposeAll();
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
