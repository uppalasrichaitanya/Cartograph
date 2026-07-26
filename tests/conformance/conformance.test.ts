/**
 * Cartograph Conformance Test Runner — All Languages
 *
 * Runs all language parsers through the shared conformance test suite.
 *
 * Each language parser follows the same pattern:
 *   1. Import the framework's runConformanceSuite
 *   2. Import the parser implementation
 *   3. Import the language-specific fixtures
 *   4. Call runConformanceSuite(parser, fixtures)
 *
 * The framework is language-agnostic — adding a new language requires
 * only new fixtures and a single runConformanceSuite() call here.
 *
 * @module tests/conformance/conformance.test
 */

import { runConformanceSuite } from "./framework";
import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";
import { typescriptFixtures } from "./typescript.fixtures";
import { PythonParser } from "@/lib/analysis/parsers/python/parser";
import { pythonFixtures } from "./python.fixtures";

// ---------------------------------------------------------------------------
// Run the TypeScript conformance suite
// ---------------------------------------------------------------------------

runConformanceSuite(new TypeScriptParser(), typescriptFixtures);

// ---------------------------------------------------------------------------
// Run the Python conformance suite
// ---------------------------------------------------------------------------

runConformanceSuite(new PythonParser(), pythonFixtures);
