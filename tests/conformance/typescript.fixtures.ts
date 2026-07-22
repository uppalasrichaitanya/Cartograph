/**
 * Cartograph Conformance Fixtures — TypeScript/JavaScript
 *
 * Language-specific test fixtures for the TypeScript parser conformance
 * suite. Each fixture describes a minimal project and the expected
 * extraction behavior.
 *
 * These fixtures cover the TS parser's core responsibilities:
 *   - Static import/export extraction
 *   - Path alias resolution (tsconfig paths)
 *   - Re-exports and barrel files
 *   - Index file resolution (directory imports)
 *   - Syntax errors → parse error with line/column
 *   - Mixed TS/JS projects
 *   - JSX support (.tsx)
 *   - Empty files (no imports)
 *   - Circular imports
 *   - Deduplication of specifiers
 *
 * Adding a fixture: add a new ConformanceFixture object to the
 * typescriptFixtures array. The conformance framework will automatically
 * run it through the full pipeline and assert the expectations.
 *
 * @module tests/conformance/typescript.fixtures
 */

import type { ConformanceFixture } from "./framework";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const typescriptFixtures: ConformanceFixture[] = [
  // -------------------------------------------------------------------------
  // 1. Simple import/export
  // -------------------------------------------------------------------------
  {
    name: "simple import and export",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          'import { helper } from "./lib/helper";',
          "",
          "export const main = () => helper();",
        ].join("\n"),
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = () => 42;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/entry.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
      externalImports: {
        "src/entry.ts": [],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 2. Path alias resolution (@/ aliases via tsconfig)
  // -------------------------------------------------------------------------
  {
    name: "path alias resolution (@/ via tsconfig)",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: 'import { helper } from "@/lib/helper";\n',
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = 1;\n",
      },
    ],
    manifests: [
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
        }),
      },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/entry.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
      externalImports: {
        "src/entry.ts": [],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 3. Re-exports
  // -------------------------------------------------------------------------
  {
    name: "re-exports are captured as imports",
    language: "typescript",
    files: [
      {
        path: "src/barrel.ts",
        content: [
          'export { helper } from "./lib/helper";',
          'export * from "./lib/utils";',
        ].join("\n"),
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = 1;\n",
      },
      {
        path: "src/lib/utils.ts",
        content: "export const utils = 2;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "src/barrel.ts": ["src/lib/helper.ts", "src/lib/utils.ts"],
        "src/lib/helper.ts": [],
        "src/lib/utils.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 4. Barrel files (index.ts) — directory imports
  // -------------------------------------------------------------------------
  {
    name: "barrel file / index.ts resolution",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: 'import { helper } from "./lib";\n',
      },
      {
        path: "src/lib/index.ts",
        content: 'export { helper } from "./helper";\n',
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = 1;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "src/entry.ts": ["src/lib/index.ts"],
        "src/lib/index.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 5. Syntax errors → parse error with structured diagnostics
  // -------------------------------------------------------------------------
  {
    name: "syntax error produces parse errors",
    language: "typescript",
    files: [
      {
        path: "broken.ts",
        content: "export const fn = (: string) => {};\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 0,
      errorFiles: ["broken.ts"],
    },
  },

  // -------------------------------------------------------------------------
  // 6. Mixed TS/JS project
  // -------------------------------------------------------------------------
  {
    name: "mixed TypeScript and JavaScript files",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: 'import { util } from "./util";\n',
      },
      {
        path: "src/util.js",
        content: 'import path from "path";\nexport const util = () => path.resolve(".");\n',
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/entry.ts": ["src/util.js"],
        "src/util.js": [],
      },
      externalImports: {
        "src/entry.ts": [],
        "src/util.js": ["path"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 7. .tsx file with JSX
  // -------------------------------------------------------------------------
  {
    name: ".tsx file with JSX syntax",
    language: "typescript",
    files: [
      {
        path: "components/App.tsx",
        content: [
          'import React from "react";',
          'import { Header } from "./Header";',
          "",
          "export const App = () => <Header />;",
        ].join("\n"),
      },
      {
        path: "components/Header.tsx",
        content: [
          'import React from "react";',
          "",
          "export const Header = () => <h1>Hello</h1>;",
        ].join("\n"),
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "components/App.tsx": ["components/Header.tsx"],
        "components/Header.tsx": [],
      },
      externalImports: {
        "components/App.tsx": ["react"],
        "components/Header.tsx": ["react"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 8. File with no imports (valid empty extraction)
  // -------------------------------------------------------------------------
  {
    name: "file with no imports produces empty extraction",
    language: "typescript",
    files: [
      {
        path: "src/constants.ts",
        content: "export const PI = 3.14159;\nexport const E = 2.71828;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 1,
      imports: {
        "src/constants.ts": [],
      },
      externalImports: {
        "src/constants.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 9. Circular imports
  // -------------------------------------------------------------------------
  {
    name: "circular imports between two files",
    language: "typescript",
    files: [
      {
        path: "src/a.ts",
        content: 'import { b } from "./b";\nexport const a = () => b();\n',
      },
      {
        path: "src/b.ts",
        content: 'import { a } from "./a";\nexport const b = () => a();\n',
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/a.ts"],
      },
      externalImports: {
        "src/a.ts": [],
        "src/b.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 10. Specifier deduplication
  // -------------------------------------------------------------------------
  {
    name: "duplicate specifiers are deduplicated",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          'import { a } from "./lib/helper";',
          'import { b } from "./lib/helper";',
          'export { c } from "./lib/helper";',
        ].join("\n"),
      },
      {
        path: "src/lib/helper.ts",
        content: "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        // Deduplication: "./lib/helper" appears only once in the resolved list
        "src/entry.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 11. External-only imports
  // -------------------------------------------------------------------------
  {
    name: "file with only external imports",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          'import React from "react";',
          'import express from "express";',
          'import { z } from "zod";',
          "",
          "export const app = express();",
        ].join("\n"),
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 1,
      imports: {
        "src/entry.ts": [],
      },
      externalImports: {
        "src/entry.ts": ["express", "react", "zod"],
      },
    },
  },
];
