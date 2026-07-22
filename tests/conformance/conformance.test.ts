/**
 * Cartograph Conformance Test Runner — TypeScript
 *
 * Runs the TypeScript parser through the shared conformance test suite.
 *
 * This file is the model for how any future language parser's conformance
 * tests should be structured:
 *   1. Import the framework's runConformanceSuite
 *   2. Import the parser implementation
 *   3. Import the language-specific fixtures
 *   4. Call runConformanceSuite(parser, fixtures)
 *
 * When adding a Python parser (Milestone 3), the corresponding test file
 * would be:
 *
 *   import { runConformanceSuite } from "./framework";
 *   import { PythonParser } from "@/lib/analysis/parsers/python/parser";
 *   import { pythonFixtures } from "./python.fixtures";
 *   runConformanceSuite(new PythonParser(), pythonFixtures);
 *
 * @module tests/conformance/conformance.test
 */

import { runConformanceSuite } from "./framework";
import { TypeScriptParser } from "@/lib/analysis/parsers/typescript/parser";
import { typescriptFixtures } from "./typescript.fixtures";

// ---------------------------------------------------------------------------
// Run the TypeScript conformance suite
// ---------------------------------------------------------------------------

runConformanceSuite(new TypeScriptParser(), typescriptFixtures);
